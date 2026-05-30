/**
 * State Manager — 循环内临时状态（phase/iteration/verification）
 * 
 * ⚠️  职责分离：
 *   - 本模块：Loop Engine 内部临时状态（阶段/循环数/验证历史/裁决历史）
 *   - SQLite stores：持久化实体数据（Objective/Goal/Task/Mission CRUD）
 *
 * 不废弃。Loop Engine 的临时状态不需要持久化到 SQLite。
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { MissionState, MissionStatus } from "../types.js";

export class StateManager {
  private statePath: string;
  private state: MissionState | null = null;
  private lockFile: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DELAY = 100;

  constructor(missionDir: string) {
    this.statePath = path.join(missionDir, "state.yaml");
    this.lockFile = path.join(missionDir, "state.lock");
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 创建初始状态（Mission 创建时调用）
   */
  createInitialState(configPath: string): MissionState {
    const now = new Date().toISOString();
    const state: MissionState = {
      goal_id: `mission_${Date.now()}`,
      status: "created",
      mission_config_path: configPath,
      current_phase: "observe",
      current_iteration: 0,
      task_tree: [],
      verification_history: [],
      judgement_history: [],
      budget_consumed: {
        tokens: 0,
        duration_minutes: 0,
        cost_usd: 0,
      },
      created_at: now,
      updated_at: now,
    };
    this.state = state;
    this.save();
    return state;
  }

  // ============================================================
  // 加载/保存
  // ============================================================

  /**
   * 从 state.yaml 加载状态
   * @returns 如果 state.yaml 不存在返回 null
   */
  load(): MissionState | null {
    if (!fs.existsSync(this.statePath)) {
      return null;
    }
    const raw = fs.readFileSync(this.statePath, "utf-8");
    this.state = yaml.parse(raw) as MissionState;
    return this.state;
  }

  /**
   * 将当前内存状态写入 state.yaml
   */
  save(immediate: boolean = false): void {
    if (!this.state) throw new Error("No state to save");

    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (immediate) { this.doSave(); }
    else { this.saveTimer = setTimeout(() => this.doSave(), this.SAVE_DELAY); }
  }

  private doSave(): void {
    if (!this.state) return;
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.state.updated_at = new Date().toISOString();
    const yamlStr = yaml.stringify(this.state, { indent: 2, lineWidth: 0 });
    try {
      fs.writeFileSync(this.statePath, yamlStr, "utf-8");
    } catch (err) {
      console.error("[StateManager] Failed to save state:", err);
    }
  }

  // ============================================================
  // 状态读取（只读，不触发 save）
  // ============================================================

  getState(): MissionState {
    if (!this.state) {
      throw new Error("State not initialized");
    }
    return this.state;
  }

  getStatus(): MissionStatus {
    return this.getState().status;
  }

  getCurrentPhase(): string {
    return this.getState().current_phase;
  }

  getCurrentIteration(): number {
    return this.getState().current_iteration;
  }

  getCurrentTaskId(): string | undefined {
    return this.getState().current_task_id;
  }

  // ============================================================
  // 状态修改（修改后自动 save）
  // ============================================================

  setStatus(status: MissionStatus): void {
    this.state!.status = status;
    this.save();
  }

  setPhase(phase: MissionState["current_phase"]): void {
    this.state!.current_phase = phase;
    this.save();
  }

  incrementIteration(): number {
    this.state!.current_iteration++;
    this.save();
    return this.state!.current_iteration;
  }

  setCurrentTaskId(taskId: string): void {
    this.state!.current_task_id = taskId;
    this.save();
  }

  updateTaskStatus(taskId: string, newStatus: import("../types.js").TaskStatus): void {
    const task = this.state!.task_tree.find(t => t.id === taskId);
    if (task) {
      task.status = newStatus;
      if (newStatus === "done" || newStatus === "failed") {
        task.completed_at = new Date().toISOString();
      }
      this.save();
    }
  }

  addVerificationRecord(record: import("../types.js").VerificationRecord): void {
    this.state!.verification_history.push(record);
    this.save();
  }

  addJudgementRecord(record: import("../types.js").JudgementRecord): void {
    this.state!.judgement_history.push(record);
    this.save();
  }

  setLastCheckpoint(checkpointId: string): void {
    this.state!.last_checkpoint_id = checkpointId;
    this.save();
  }

  setLastError(error: string): void {
    this.state!.last_error = error;
    this.save();
  }

  consumeTokens(amount: number): void {
    this.state!.budget_consumed.tokens += amount;
    this.save();
  }

  // ============================================================
  // 锁机制（Phase 4 多 Mission 并行时启用）
  // ============================================================

  acquireLock(): boolean {
    if (fs.existsSync(this.lockFile)) {
      return false;
    }
    fs.writeFileSync(this.lockFile, String(process.pid), "utf-8");
    return true;
  }

  releaseLock(): void {
    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
    }
  }

  isLocked(): boolean {
    return fs.existsSync(this.lockFile);
  }

  // ============================================================
  // 检查点恢复
  // ============================================================

  /**
   * 检查是否有未完成的 Mission（state.yaml 存在且 status 为 running/paused）
   */
  hasUnfinishedMission(): boolean {
    if (!fs.existsSync(this.statePath)) {
      return false;
    }
    const state = this.load();
    return state !== null && 
      (state.status === "running" || state.status === "paused" || state.status === "failed");
  }
}
