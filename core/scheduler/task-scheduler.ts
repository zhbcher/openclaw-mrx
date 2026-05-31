/**
 * Task Scheduler — DAG 并发执行引擎
 * 
 * 支持并行执行无依赖关系的任务，通过 PromisePool 控制并发度。
 * 
 * 状态机: PENDING → READY → RUNNING → DONE/FAILED/BLOCKED
 */

import * as fs from "fs";
import * as path from "path";
import type { TaskNode } from "../types.js";
import type { Executor, TaskInput, TaskResult } from "../executor/executor.js";
import type { ExecutorRegistry } from "../executor/executor-registry.js";

export interface TaskSchedulerCheckpoint {
  runId: string;
  completedTaskIds: string[];
  totalTasks: number;
  timestamp: string;
}

export interface SchedulerConfig {
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 失败后是否停止所有任务 */
  stopOnFailure: boolean;
  /** 单个任务超时（ms） */
  taskTimeoutMs: number;
  /** 失败任务最大重试次数 */
  maxRetries: number;
  /** Checkpoint 持久化配置（可选，启用后任务可中断恢复） */
  checkpoint?: {
    /** Checkpoint 文件存储目录 */
    storageDir: string;
    /** 任务运行 ID（用于恢复匹配） */
    runId: string;
  };
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

  // ================================================================
  // Checkpoint 支持（中断恢复）
  // ================================================================

  private getCheckpointPath(): string | null {
    if (!this.config.checkpoint) return null;
    return path.join(this.config.checkpoint.storageDir, "checkpoint.json");
  }

  private loadCheckpoint(): TaskSchedulerCheckpoint | null {
    const cpPath = this.getCheckpointPath();
    if (!cpPath || !fs.existsSync(cpPath)) return null;
    try {
      const raw = fs.readFileSync(cpPath, "utf-8");
      const cp: TaskSchedulerCheckpoint = JSON.parse(raw);
      console.log(`  📋 Checkpoint 加载: ${cp.completedTaskIds.length} 个已完成任务 (${cp.timestamp})`);
      return cp;
    } catch (err) {
      console.warn(`  ⚠️  Checkpoint 加载失败: ${err}`);
      return null;
    }
  }

  private saveCheckpoint(completedTaskIds: string[], totalTasks: number): void {
    const cpPath = this.getCheckpointPath();
    if (!cpPath || !this.config.checkpoint) return;
    
    // 确保目录存在
    const dir = path.dirname(cpPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const cp: TaskSchedulerCheckpoint = {
      runId: this.config.checkpoint.runId,
      completedTaskIds: [...new Set(completedTaskIds)],
      totalTasks,
      timestamp: new Date().toISOString(),
    };
    
    fs.writeFileSync(cpPath, JSON.stringify(cp, null, 2), "utf-8");
    console.log(`  💾 Checkpoint 已保存: ${cp.completedTaskIds.length}/${cp.totalTasks} 任务`);
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

    // ===== Checkpoint 恢复：跳过已完成任务 =====
    const checkpoint = this.loadCheckpoint();
    const skipTaskIds = new Set(checkpoint?.completedTaskIds || []);
    if (skipTaskIds.size > 0) {
      console.log(`  ⏭️  跳过 ${skipTaskIds.size} 个已完成的 checkpoint 任务`);
      for (const [id, state] of taskStates) {
        if (skipTaskIds.has(id)) {
          state.status = "done";
          completed.push({
            success: true,
            output: "[从 Checkpoint 恢复] 任务已在前次运行中完成",
            error: "",
            durationMs: 0,
            action: { type: "shell", target: state.description },
          });
          console.log(`    ↪ ${id}: ${state.description}`);
        }
      }
    }

    // 获取就绪任务（无依赖 或 依赖已满足）
    const getReadyTasks = (): TaskNode[] => {
      return [...taskStates.values()].filter(t => {
        if (t.status !== "pending" && t.status !== "ready" && t.status !== "retrying" && !skipTaskIds.has(t.id)) return false;
        // 如果跳过集中有该依赖，视为满足
        return t.depends_on.every(depId => {
          const dep = taskStates.get(depId);
          return (dep && dep.status === "done") || skipTaskIds.has(depId);
        });
      });
    };

    // 保存 checkpoint 辅助函数
    const checkpointSave = () => {
      const doneIds = [...taskStates.values()]
        .filter(t => t.status === "done")
        .map(t => t.id);
      // 合并已有 checkpoint 的任务 ID
      const allDone = new Set([...doneIds, ...skipTaskIds]);
      this.saveCheckpoint([...allDone], tasks.length);
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
      
      // ===== 任务完成后写入 Checkpoint =====
      checkpointSave();
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
  async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await this.waitOne();
    }
  }
}
