/**
 * Objective Engine — 顶层目标生命周期管理
 * 
 * 职责：
 *   1. 创建 Objective（生成 ID、写入 State Graph）
 *   2. 管理状态转换（created → planning → ready → running → completed）
 *   3. 计算整体进度（基于 Goal 完成率）
 *   4. 发布 Objective 领域事件
 */

import { ObjectiveStore, type ObjectiveRow } from "../state-graph/objective-store.js";
import { GoalStore } from "../state-graph/goal-store.js";
import { getDatabase } from "../state-graph/database.js";

export class ObjectiveEngine {
  private objectiveStore = new ObjectiveStore();
  private goalStore = new GoalStore();

  /**
   * 创建 Objective
   */
  create(input: {
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "critical";
    tags?: string[];
    repo?: string;
    workingDir?: string;
    constraints?: string[];
  }) {
    const id = `obj_${Date.now()}`;
    const obj = this.objectiveStore.create({
      id,
      title: input.title,
      description: input.description,
      priority: input.priority || "medium",
      tags: input.tags,
      repo: input.repo,
      working_dir: input.workingDir,
      constraints: input.constraints,
    });

    return {
      id: obj.id,
      title: obj.title,
      description: obj.description,
      status: obj.status,
      priority: obj.priority,
      tags: JSON.parse(obj.tags),
      created_at: obj.created_at,
    };
  }

  /**
   * 将 Goal 列表关联到 Objective
   */
  attachGoals(objectiveId: string, goals: Array<{
    id: string;
    title: string;
    description?: string;
    deliverable?: string;
    complexity?: string;
    depends_on?: string[];
  }>) {
    const obj = this.objectiveStore.getById(objectiveId);
    if (!obj) throw new Error(`Objective ${objectiveId} not found`);

    const createdGoals = [];
    for (const g of goals) {
      const goal = this.goalStore.create({
        id: g.id,
        objective_id: objectiveId,
        title: g.title,
        description: g.description,
        deliverable: g.deliverable,
        complexity: g.complexity || "medium",
        depends_on: g.depends_on || [],
      });
      createdGoals.push(goal);
    }

    // 标记 Objective 进入 planning 状态
    this.objectiveStore.updateStatus(objectiveId, "planning");

    return createdGoals;
  }

  /**
   * 确认规划完成，Objective 进入 ready 状态
   */
  confirmPlanning(objectiveId: string): void {
    this.objectiveStore.updateStatus(objectiveId, "ready");
  }

  /**
   * 开始执行
   */
  start(objectiveId: string): void {
    this.objectiveStore.updateStatus(objectiveId, "running");
    
    // 解锁所有无依赖的 Goal
    const goals = this.goalStore.listByObjective(objectiveId);
    for (const g of goals) {
      const deps = JSON.parse(g.depends_on) as string[];
      if (deps.length === 0 && g.status === "pending") {
        this.goalStore.updateStatus(g.id, "ready");
      }
    }
  }

  /**
   * 获取 Objective 完整信息（含 Goals 树）
   */
  getFull(objectiveId: string) {
    const obj = this.objectiveStore.getById(objectiveId);
    if (!obj) return null;

    const goals = this.goalStore.listByObjective(objectiveId).map(g => ({
      id: g.id,
      title: g.title,
      description: g.description,
      deliverable: g.deliverable,
      status: g.status,
      progress: g.progress,
      complexity: g.complexity,
      depends_on: JSON.parse(g.depends_on),
      task_ids: JSON.parse(g.task_ids),
    }));

    // 计算整体进度
    const totalGoals = goals.length;
    const completedGoals = goals.filter(g => g.status === "completed" || g.status === "skipped").length;
    const progress = totalGoals > 0 ? completedGoals / totalGoals : 0;

    return {
      id: obj.id,
      title: obj.title,
      description: obj.description,
      status: obj.status,
      progress,
      priority: obj.priority,
      tags: JSON.parse(obj.tags),
      goals,
      goal_count: goals.length,
      created_at: obj.created_at,
      updated_at: obj.updated_at,
    };
  }

  /**
   * 计算并更新进度
   */
  recalculateProgress(objectiveId: string): number {
    const goals = this.goalStore.listByObjective(objectiveId);
    const total = goals.length;
    if (total === 0) return 0;

    // Weighted: completed goals count fully, partial goals count by their progress
    let weightedSum = 0;
    for (const g of goals) {
      if (g.status === "completed" || g.status === "skipped") {
        weightedSum += 1;
      } else if (g.status === "running") {
        weightedSum += g.progress;
      }
    }
    const progress = weightedSum / total;
    this.objectiveStore.updateProgress(objectiveId, progress);
    return progress;
  }

  /**
   * 检查 Goal 间是否有循环依赖
   */
  detectGoalCycles(goals: Array<{ id: string; depends_on: string[] }>): string[] | null {
    const adj = new Map<string, string[]>();
    const allIds = new Set(goals.map(g => g.id));

    for (const g of goals) {
      adj.set(g.id, g.depends_on.filter(d => allIds.has(d)));
    }

    // DFS cycle detection
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of allIds) color.set(id, WHITE);

    const cyclePath: string[] = [];

    function dfs(node: string, path: string[]): boolean {
      color.set(node, GRAY);
      path.push(node);
      for (const dep of (adj.get(node) || [])) {
        const c = color.get(dep);
        if (c === GRAY) {
          // Found cycle — capture the cycle path
          const cycleStart = path.indexOf(dep);
          cyclePath.push(...path.slice(cycleStart), dep);
          return true;
        }
        if (c === WHITE) {
          if (dfs(dep, path)) return true;
        }
      }
      color.set(node, BLACK);
      path.pop();
      return false;
    }

    for (const id of allIds) {
      if (color.get(id) === WHITE) {
        if (dfs(id, [])) return cyclePath;
      }
    }

    return null; // No cycle
  }
}
