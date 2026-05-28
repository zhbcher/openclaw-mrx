/**
 * Checkpoint System — 阶段快照
 * 
 * 不做 checkpoint 的 Agent 是薛定谔的 Agent。
 * 每次 checkpoint 保存完整的 state + context，确保可从中断点精确恢复。
 * 
 * Phase 1：基于 phase 策略的快照（每个循环作为一个阶段）
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { Checkpoint, MissionState } from "../types.js";

export class CheckpointManager {
  private checkpointsDir: string;
  private missionId: string;

  constructor(storageRoot: string, missionId: string) {
    this.missionId = missionId;
    this.checkpointsDir = path.join(storageRoot, "checkpoints", missionId);
  }

  /**
   * 创建快照
   */
  create(state: MissionState, contextSummary: string): Checkpoint {
    // 确保目录存在
    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true });
    }

    const cpId = `cp_${String(state.current_iteration).padStart(3, "0")}_${state.current_phase}`;
    const cpDir = path.join(this.checkpointsDir, cpId);
    fs.mkdirSync(cpDir, { recursive: true });

    const checkpoint: Checkpoint = {
      id: cpId,
      mission_id: this.missionId,
      iteration: state.current_iteration,
      timestamp: new Date().toISOString(),
      phase: state.current_phase,
      state_snapshot: JSON.parse(JSON.stringify(state)), // 深拷贝
      context_summary: contextSummary,
    };

    // 写入快照文件
    const yamlStr = yaml.stringify(checkpoint, { indent: 2, lineWidth: 0 });
    fs.writeFileSync(path.join(cpDir, "checkpoint.yaml"), yamlStr, "utf-8");

    // 写入人类可读摘要
    const summary = this.generateSummary(checkpoint);
    fs.writeFileSync(path.join(cpDir, "summary.md"), summary, "utf-8");

    console.log(`  📸 Checkpoint 已创建: ${cpId}`);
    return checkpoint;
  }

  /**
   * 获取最新 checkpoint
   */
  getLatest(): Checkpoint | null {
    if (!fs.existsSync(this.checkpointsDir)) {
      return null;
    }

    const entries = fs.readdirSync(this.checkpointsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name)); // 按名称倒序

    if (entries.length === 0) return null;

    const latestDir = path.join(this.checkpointsDir, entries[0].name);
    const cpFile = path.join(latestDir, "checkpoint.yaml");

    if (!fs.existsSync(cpFile)) return null;

    const raw = fs.readFileSync(cpFile, "utf-8");
    return yaml.parse(raw) as Checkpoint;
  }

  /**
   * 列出所有 checkpoint
   */
  listAll(): Checkpoint[] {
    if (!fs.existsSync(this.checkpointsDir)) return [];

    return fs.readdirSync(this.checkpointsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const cpFile = path.join(this.checkpointsDir, e.name, "checkpoint.yaml");
        if (!fs.existsSync(cpFile)) return null;
        const raw = fs.readFileSync(cpFile, "utf-8");
        return yaml.parse(raw) as Checkpoint;
      })
      .filter((c): c is Checkpoint => c !== null)
      .sort((a, b) => b.iteration - a.iteration);
  }

  /**
   * 生成人类可读摘要
   */
  private generateSummary(cp: Checkpoint): string {
    const state = cp.state_snapshot;
    const tasksDone = state.task_tree.filter(t => t.status === "done").length;
    const tasksTotal = state.task_tree.length;

    return [
      `# Checkpoint: ${cp.id}`,
      ``,
      `- **Mission**: ${this.missionId}`,
      `- **时间**: ${cp.timestamp}`,
      `- **循环**: #${cp.iteration}`,
      `- **阶段**: ${cp.phase}`,
      `- **任务进度**: ${tasksDone}/${tasksTotal}`,
      `- **验证历史**: ${state.verification_history.length} 次`,
      `- **Token 消耗**: ${state.budget_consumed.tokens.toLocaleString()}`,
      ``,
      `## 上下文摘要`,
      cp.context_summary,
      ``,
      `## 当前任务树`,
      ...state.task_tree.map(t =>
        `- [${t.status === "done" ? "x" : " "}] ${t.id}: ${t.description}`
      ),
    ].join("\n");
  }
}
