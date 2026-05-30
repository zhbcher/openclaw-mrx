/**
 * Checkpoint Manager V2 — 基于 State Graph 的真正快照与回滚
 * 
 * V1 问题：yaml 文件快照只能读不能恢复。
 * V2：直接从 SQLite 创建状态快照，rollback 时将快照写回 SQLite。
 */

import { getDatabase } from "../state-graph/database.js";
import { ObjectiveStore } from "../state-graph/objective-store.js";
import { GoalStore } from "../state-graph/goal-store.js";

export interface CheckpointSnapshot {
  id: string;
  mission_id: string;
  created_at: string;
  iteration: number;
  phase: string;

  // 快照数据（从 SQLite 读取的完整行）
  objective: {
    id: string; title: string; status: string; progress: number;
    updated_at: string;
  };
  goals: Array<{
    id: string; title: string; status: string; progress: number;
    depends_on: string; task_ids: string;
  }>;
  tasks: Array<{
    id: string; goal_id: string; description: string; status: string;
    retry_count: number; depends_on: string; children: string;
  }>;

  context_summary: string;
  parent_checkpoint_id?: string;
}

export class CheckpointManagerV2 {
  private db = getDatabase();
  private objectiveStore = new ObjectiveStore();
  private goalStore = new GoalStore();

  /**
   * 创建快照 — 从 SQLite 读取当前状态并存储
   */
  create(
    missionId: string,
    objectiveId: string,
    iteration: number,
    phase: string,
    contextSummary: string,
    parentCheckpointId?: string
  ): CheckpointSnapshot {
    const now = new Date().toISOString();
    const id = `cp_${missionId}_${String(iteration).padStart(3, "0")}_${phase}`;

    // 从 SQLite 读取当前状态
    const objective = this.objectiveStore.getById(objectiveId);
    const goals = this.goalStore.listByObjective(objectiveId);
    const tasks = this.loadAllTasks(objectiveId);

    const snapshot: CheckpointSnapshot = {
      id,
      mission_id: missionId,
      created_at: now,
      iteration,
      phase,
      objective: objective ? {
        id: objective.id,
        title: objective.title,
        status: objective.status,
        progress: objective.progress,
        updated_at: objective.updated_at,
      } : { id: objectiveId, title: "unknown", status: "unknown", progress: 0, updated_at: now },
      goals: goals.map(g => ({
        id: g.id, title: g.title, status: g.status,
        progress: g.progress, depends_on: g.depends_on, task_ids: g.task_ids,
      })),
      tasks: tasks.map(t => ({
        id: t.id, goal_id: t.goal_id, description: t.description,
        status: t.status, retry_count: t.retry_count,
        depends_on: t.depends_on, children: t.children,
      })),
      context_summary: contextSummary,
      parent_checkpoint_id: parentCheckpointId,
    };

    // 写入 checkpoints 表
    this.db.prepare(`
      INSERT INTO checkpoints (id, mission_id, iteration, phase, snapshot_data, context_summary, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, missionId, iteration, phase,
      JSON.stringify(snapshot), contextSummary,
      parentCheckpointId || null, now
    );

    console.log(`  📸 Checkpoint: ${id} (iteration #${iteration})`);
    return snapshot;
  }

  /**
   * 获取最新快照
   */
  getLatest(missionId: string): CheckpointSnapshot | null {
    const row = this.db.prepare(
      "SELECT snapshot_data FROM checkpoints WHERE mission_id = ? ORDER BY iteration DESC LIMIT 1"
    ).get(missionId) as any;

    return row ? JSON.parse(row.snapshot_data) : null;
  }

  /**
   * 按 ID 获取快照
   */
  getById(id: string): CheckpointSnapshot | null {
    const row = this.db.prepare(
      "SELECT snapshot_data FROM checkpoints WHERE id = ?"
    ).get(id) as any;

    return row ? JSON.parse(row.snapshot_data) : null;
  }

  /**
   * 列出某 Mission 的所有快照
   */
  listAll(missionId: string): CheckpointSnapshot[] {
    const rows = this.db.prepare(
      "SELECT snapshot_data FROM checkpoints WHERE mission_id = ? ORDER BY iteration ASC"
    ).all(missionId) as any[];

    return rows.map(r => JSON.parse(r.snapshot_data));
  }

  /**
   * 回滚 — 将快照状态写回 SQLite
   */
  async rollback(checkpointId: string): Promise<{
    success: boolean;
    restored: { objective: string; goals: number; tasks: number };
    fromCheckpoint: CheckpointSnapshot;
  }> {
    const snapshot = this.getById(checkpointId);
    if (!snapshot) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    console.log(`  ⏪ 回滚到 Checkpoint: ${checkpointId} (iteration #${snapshot.iteration})`);

    // 1. 恢复 Objective 状态
    this.db.prepare(`
      UPDATE objectives SET status = ?, progress = ?, updated_at = ? WHERE id = ?
    `).run(snapshot.objective.status, snapshot.objective.progress, new Date().toISOString(), snapshot.objective.id);

    // 2. 恢复 Goal 状态
    for (const g of snapshot.goals) {
      this.db.prepare(`
        UPDATE goals SET status = ?, progress = ?, updated_at = ? WHERE id = ?
      `).run(g.status, g.progress, new Date().toISOString(), g.id);
    }

    // 3. 恢复 Task 状态
    for (const t of snapshot.tasks) {
      this.db.prepare(`
        UPDATE tasks SET status = ?, retry_count = ?, updated_at = ? WHERE id = ?
      `).run(t.status, t.retry_count, new Date().toISOString(), t.id);
    }

    // 4. 记录 rollback 事件
    this.db.prepare(`
      INSERT INTO events (event_id, event_type, mission_id, payload) VALUES (?, ?, ?, ?)
    `).run(
      `evt_rollback_${Date.now()}`,
      "checkpoint.rollback_executed",
      snapshot.mission_id,
      JSON.stringify({
        checkpoint_id: checkpointId,
        restored_iteration: snapshot.iteration,
        restored_goal_count: snapshot.goals.length,
        restored_task_count: snapshot.tasks.length,
      })
    );

    return {
      success: true,
      restored: {
        objective: snapshot.objective.id,
        goals: snapshot.goals.length,
        tasks: snapshot.tasks.length,
      },
      fromCheckpoint: snapshot,
    };
  }

  /**
   * 计算两个 checkpoint 之间的差异
   */
  diff(fromId: string, toId: string): {
    goalChanges: Array<{ id: string; title: string; from: string; to: string }>;
    taskChanges: Array<{ id: string; description: string; from: string; to: string }>;
  } {
    const from = this.getById(fromId);
    const to = this.getById(toId);
    if (!from || !to) throw new Error("Checkpoint not found");

    const goalChanges: Array<{ id: string; title: string; from: string; to: string }> = [];
    const taskChanges: Array<{ id: string; description: string; from: string; to: string }> = [];

    const fromGoalMap = new Map(from.goals.map(g => [g.id, g]));
    const toGoalMap = new Map(to.goals.map(g => [g.id, g]));

    for (const [id, tg] of toGoalMap) {
      const fg = fromGoalMap.get(id);
      if (fg && fg.status !== tg.status) {
        goalChanges.push({ id, title: tg.title, from: fg.status, to: tg.status });
      }
    }

    const fromTaskMap = new Map(from.tasks.map(t => [t.id, t]));
    const toTaskMap = new Map(to.tasks.map(t => [t.id, t]));

    for (const [id, tt] of toTaskMap) {
      const ft = fromTaskMap.get(id);
      if (ft && ft.status !== tt.status) {
        taskChanges.push({ id, description: tt.description.slice(0, 50), from: ft.status, to: tt.status });
      }
    }

    return { goalChanges, taskChanges };
  }

  // ============================================================
  // 辅助
  // ============================================================

  private loadAllTasks(objectiveId: string): Array<{
    id: string; goal_id: string; description: string; status: string;
    retry_count: number; depends_on: string; children: string;
  }> {
    const goals = this.goalStore.listByObjective(objectiveId);
    const allTasks: any[] = [];

    for (const g of goals) {
      const taskIds: string[] = JSON.parse(g.task_ids);
      for (const tid of taskIds) {
        const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(tid) as any;
        if (task) allTasks.push(task);
      }
    }

    return allTasks;
  }
}
