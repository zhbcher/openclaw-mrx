/**
 * Mission Scheduler — 多 Mission 并行调度
 *
 * Phase 4a: 管理多个 Mission 的并发执行。
 *   - 按优先级排序
 *   - 每个 Mission 独立执行上下文
 *   - 通过 MissionRegistry 追踪状态
 *   - 优雅关闭（SIGINT → 暂停所有运行中 Mission）
 */

import { MissionRegistry } from "../state/mission-registry.js";
import { LoopEngine } from "../runtime/loop-engine.js";
import type { MissionRecord } from "../state/mission-registry.js";
import type { LlmClient } from "../planner/dag-planner.js";

export interface SchedulerOptions {
  storageRoot: string;
  missionActiveDir: string;
  maxConcurrent?: number;
  llmClient?: LlmClient;
}

interface RunningMission {
  record: MissionRecord;
  engine: LoopEngine;
  promise: Promise<void>;
}

export class MissionScheduler {
  private _registry: MissionRegistry;
  private options: SchedulerOptions;
  private running: Map<string, RunningMission> = new Map();
  private maxConcurrent: number;
  private _shutdown = false;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.maxConcurrent = options.maxConcurrent || 3;
    this._registry = new MissionRegistry(options.storageRoot);
  }

  get registry(): MissionRegistry {
    return this._registry;
  }

  /**
   * 注册新 Mission
   */
  register(
    id: string,
    name: string,
    configPath: string,
    statePath: string,
    priority: number = 5
  ): MissionRecord {
    return this.registry.register({
      id,
      name,
      config_path: configPath,
      state_path: statePath,
      status: "created",
      priority,
      current_iteration: 0,
      dag_progress_done: 0,
      dag_progress_total: 0,
      last_checkpoint_id: null,
      last_error: null,
      started_at: null,
      completed_at: null,
    });
  }

  /**
   * 启动单个 Mission
   */
  async startMission(missionId: string): Promise<void> {
    const record = this.registry.get(missionId);
    if (!record) throw new Error(`Mission not found: ${missionId}`);

    // 检查是否已在运行
    if (this.running.has(missionId)) {
      throw new Error(`Mission already running: ${missionId}`);
    }

    // 检查并发数
    if (this.running.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent missions reached (${this.maxConcurrent})`);
    }

    this.registry.updateStatus(missionId, "running");

    const engine = new LoopEngine({
      configPath: record.config_path,
      missionDir: record.state_path,
      storageRoot: this.options.storageRoot,
      llmClient: this.options.llmClient,
    });

    const promise = engine.start().then(() => {
      this.running.delete(missionId);
      this.registry.updateStatus(missionId, "completed");
    }).catch(err => {
      this.running.delete(missionId);
      this.registry.updateStatus(missionId, "failed");
      this.registry.updateProgress(missionId, record.current_iteration, record.dag_progress_done, record.dag_progress_total, undefined, err.message);
      console.error(`Mission ${missionId} failed:`, err.message);
    });

    this.running.set(missionId, { record, engine, promise });
  }

  /**
   * 启动所有 ready 状态的 Mission（按优先级）
   */
  async startReady(): Promise<number> {
    const runnable = this.registry.getRunnable();
    let started = 0;

    for (const record of runnable) {
      if (this._shutdown) break;
      if (this.running.size >= this.maxConcurrent) break;
      if (this.running.has(record.id)) continue;

      try {
        await this.startMission(record.id);
        started++;
      } catch (err) {
        console.error(`Failed to start ${record.id}:`, (err as Error).message);
      }
    }

    return started;
  }

  /**
   * 暂停 Mission
   */
  async pauseMission(missionId: string): Promise<void> {
    const running = this.running.get(missionId);
    if (!running) {
      // 直接更新状态
      this.registry.updateStatus(missionId, "paused");
      return;
    }
    // 无法强制暂停 loop engine 的 running 状态，标记后等待自然结束
    this.registry.updateStatus(missionId, "paused");
  }

  /**
   * 恢复 Mission
   */
  async resumeMission(missionId: string): Promise<void> {
    const record = this.registry.get(missionId);
    if (!record) throw new Error(`Mission not found: ${missionId}`);
    if (record.status !== "paused" && record.status !== "failed") {
      throw new Error(`Mission cannot be resumed: status=${record.status}`);
    }
    await this.startMission(missionId);
  }

  /**
   * 获取运行状态
   */
  getStatus(): {
    running: Array<{ id: string; name: string; iteration: number; dag: string }>;
    stats: ReturnType<MissionRegistry["getStats"]>;
  } {
    const running = Array.from(this.running.entries()).map(([id, rm]) => ({
      id,
      name: rm.record.name,
      iteration: rm.record.current_iteration,
      dag: `${rm.record.dag_progress_done}/${rm.record.dag_progress_total}`,
    }));

    return {
      running,
      stats: this.registry.getStats(),
    };
  }

  /**
   * 优雅关闭
   */
  async shutdownScheduler(): Promise<void> {
    this._shutdown = true;
    console.log(`\n⏸️  Scheduler shutdown: ${this.running.size} missions running`);

    for (const [id] of this.running) {
      this.registry.updateStatus(id, "paused");
    }

    // 等待所有运行中的 Mission 完成当前循环
    const promises = Array.from(this.running.values()).map(r => r.promise);
    await Promise.allSettled(promises);

    this.registry.close();
    console.log("✅ Scheduler shutdown complete");
  }
}
