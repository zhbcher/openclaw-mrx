/**
 * Task Scheduler — DAG 并发执行引擎
 * 
 * 支持并行执行无依赖关系的任务，通过 PromisePool 控制并发度。
 * 
 * 状态机: PENDING → READY → RUNNING → DONE/FAILED/BLOCKED
 */

import type { TaskNode } from "../types.js";
import type { Executor, TaskInput, TaskResult } from "../executor/executor.js";
import type { ExecutorRegistry } from "../executor/executor-registry.js";

export interface SchedulerConfig {
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 失败后是否停止所有任务 */
  stopOnFailure: boolean;
  /** 单个任务超时（ms） */
  taskTimeoutMs: number;
  /** 失败任务最大重试次数 */
  maxRetries: number;
}

export interface SchedulerResult {
  completed: TaskResult[];
  failed: TaskResult[];
  skipped: TaskResult[];
  totalDurationMs: number;
  /** 效率提升倍数（相对串行） */
  speedup: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxConcurrency: 4,
  stopOnFailure: false,
  taskTimeoutMs: 300_000,
  maxRetries: 2,
};

export class TaskScheduler {
  private config: SchedulerConfig;
  private registry: ExecutorRegistry;

  constructor(registry: ExecutorRegistry, config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = registry;
  }

  /**
   * 并发执行 DAG 中的所有就绪任务
   */
  async executeDAG(
    tasks: TaskNode[],
    workingDir: string,
    onProgress?: (taskId: string, status: string, result?: TaskResult) => void
  ): Promise<SchedulerResult> {
    const started = Date.now();
    const completed: TaskResult[] = [];
    const failed: TaskResult[] = [];
    const skipped: TaskResult[] = [];

    // 复制任务状态（不修改原始 DAG）
    const taskStates = new Map(tasks.map(t => [t.id, { ...t }]));
    const results = new Map<string, TaskResult>();

    // 获取就绪任务（无依赖 或 依赖已满足）
    const getReadyTasks = (): TaskNode[] => {
      return [...taskStates.values()].filter(t => {
        if (t.status !== "pending" && t.status !== "ready" && t.status !== "retrying") return false;
        return t.depends_on.every(depId => {
          const dep = taskStates.get(depId);
          return dep && dep.status === "done";
        });
      });
    };

    // 执行单个任务
    const executeOne = async (task: TaskNode): Promise<void> => {
      task.status = "running";
      onProgress?.(task.id, "running");

      let result: TaskResult | null = null;
      let retries = 0;

      while (retries <= this.config.maxRetries) {
        try {
          result = await this.registry.dispatch({
            description: task.description,
            workingDir,
            action: { type: "shell", target: `echo "[MRX] ${task.description}"`, timeoutMs: this.config.taskTimeoutMs },
          });
          
          if (result.success) break;
          retries++;
        } catch (err) {
          result = {
            success: false,
            output: "",
            error: String(err),
            durationMs: this.config.taskTimeoutMs,
            action: { type: "shell", target: task.description },
          };
          retries++;
        }
      }

      results.set(task.id, result!);
      
      if (result!.success) {
        task.status = "done";
        completed.push(result!);
        onProgress?.(task.id, "done", result!);
      } else {
        task.status = "failed";
        failed.push(result!);
        onProgress?.(task.id, "failed", result!);
        
        // 标记所有依赖此任务的后继任务为 blocked
        for (const t of taskStates.values()) {
          if (t.depends_on.includes(task.id) && t.status === "pending") {
            t.status = "blocked";
          }
        }
      }
    };

    // PromisePool 并发控制
    const pool = new PromisePool(this.config.maxConcurrency);

    // 主循环：持续获取就绪任务并提交到池中
    let allDone = false;
    let failureCount = 0;

    while (!allDone) {
      const readyTasks = getReadyTasks();
      
      if (readyTasks.length === 0) {
        // 检查是否全部完成
        const remaining = [...taskStates.values()].filter(t => 
          t.status !== "done" && t.status !== "failed"
        );
        
        if (remaining.length === 0) {
          allDone = true;
        } else if (remaining.every(t => t.status === "blocked")) {
          // Deadlock: 所有剩余任务都被阻塞
          for (const t of remaining) {
            skipped.push({
              success: false,
              output: "",
              error: `Task "${t.id}" blocked by failed dependencies`,
              durationMs: 0,
              action: { type: "shell", target: t.description },
            });
          }
          allDone = true;
        } else {
          // 等待运行中的任务完成
          await pool.drain();
          continue;
        }
        break;
      }

      // 提交就绪任务
      for (const task of readyTasks) {
        pool.submit(() => executeOne(task));
        failureCount = failed.length;
        
        if (this.config.stopOnFailure && failureCount > 0) {
          await pool.drain();
          allDone = true;
          break;
        }
      }

      // 等待至少一个任务完成后再检查下一批
      if (!allDone) {
        await pool.waitOne();
      }
    }

    // 等待所有任务完成
    await pool.drain();

    const totalDuration = Date.now() - started;
    
    // 计算加速比（串行总时间 / 并行总时间）
    const serialDuration = completed.reduce((s, r) => s + r.durationMs, 0) + 
                           failed.reduce((s, r) => s + r.durationMs, 0);
    const speedup = totalDuration > 0 ? serialDuration / (completed.length + failed.length || 1) / (totalDuration / Math.max(1, completed.length + failed.length)) : 1;

    return { completed, failed, skipped, totalDurationMs: totalDuration, speedup: Math.round(speedup * 100) / 100 };
  }
}

/**
 * PromisePool — 限制并发数的异步执行池
 */
class PromisePool {
  private max: number;
  private running = 0;
  private queue: Array<() => Promise<void>> = [];
  private resolveWait: (() => void) | null = null;

  constructor(max: number) {
    this.max = max;
  }

  submit(fn: () => Promise<void>): void {
    this.queue.push(fn);
    this.tryRun();
  }

  private tryRun(): void {
    while (this.running < this.max && this.queue.length > 0) {
      const fn = this.queue.shift()!;
      this.running++;
      fn().finally(() => {
        this.running--;
        this.resolveWait?.();
        this.resolveWait = null;
        this.tryRun();
      });
    }
  }

  /** 等待至少一个任务完成 */
  waitOne(): Promise<void> {
    return new Promise(resolve => {
      this.resolveWait = resolve;
    });
  }

  /** 等待所有任务完成 */
  drain(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.running === 0 && this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}
