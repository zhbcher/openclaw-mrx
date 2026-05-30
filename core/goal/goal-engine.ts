/**
 * Goal Engine — 子目标生命周期管理
 * 
 * 职责：
 *   1. Goal 状态转换（pending → ready → running → completed）
 *   2. 依赖解析（依赖的 Goal 完成 → 自动解锁当前 Goal）
 *   3. 进度计算（基于 Task 完成率）
 */

import { GoalStore } from "../state-graph/goal-store.js";

export class GoalEngine {
  private goalStore = new GoalStore();

  /**
   * 当某个 Goal 完成时，解锁所有依赖它的 Goal
   */
  onGoalCompleted(completedGoalId: string, objectiveId: string): string[] {
    const unlocked: string[] = [];
    const allGoals = this.goalStore.listByObjective(objectiveId);
    const completedGoal = this.goalStore.getById(completedGoalId);

    if (!completedGoal) return unlocked;

    // 标记当前 Goal 为 completed
    if (completedGoal.status !== "completed") {
      this.goalStore.updateStatus(completedGoalId, "completed");
    }

    // 找到所有依赖此 Goal 的 Goal
    for (const goal of allGoals) {
      if (goal.status !== "pending") continue;
      const deps: string[] = JSON.parse(goal.depends_on);
      if (!deps.includes(completedGoalId)) continue;

      // 检查是否所有依赖都已满足
      const allDepsSatisfied = deps.every(depId => {
        const depGoal = this.goalStore.getById(depId);
        return depGoal && (depGoal.status === "completed" || depGoal.status === "skipped");
      });

      if (allDepsSatisfied) {
        this.goalStore.updateStatus(goal.id, "ready");
        unlocked.push(goal.id);
      }
    }

    return unlocked;
  }

  /**
   * 将 Goal 标记为 blocked
   */
  block(goalId: string, reason: string): void {
    this.goalStore.updateStatus(goalId, "blocked", reason);
  }

  /**
   * 解除 blocked 状态
   */
  unblock(goalId: string): void {
    this.goalStore.updateStatus(goalId, "ready");
  }

  /**
   * 开始执行 Goal
   */
  start(goalId: string): void {
    this.goalStore.updateStatus(goalId, "running");
  }

  /**
   * 跳过 Goal
   */
  skip(goalId: string, reason: string): void {
    this.goalStore.updateStatus(goalId, "skipped", reason);
  }

  /**
   * 标记 Goal 失败
   */
  fail(goalId: string, error: string): void {
    this.goalStore.updateStatus(goalId, "failed", error);
  }

  /**
   * 获取 Goal 的依赖状态
   */
  getDependencyStatus(goalId: string): {
    total: number;
    satisfied: number;
    pending: Array<{ id: string; status: string }>;
    allSatisfied: boolean;
  } {
    const goal = this.goalStore.getById(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const deps: string[] = JSON.parse(goal.depends_on);
    const pending: Array<{ id: string; status: string }> = [];
    let satisfied = 0;

    for (const depId of deps) {
      const depGoal = this.goalStore.getById(depId);
      if (depGoal && (depGoal.status === "completed" || depGoal.status === "skipped")) {
        satisfied++;
      } else if (depGoal) {
        pending.push({ id: depId, status: depGoal.status });
      } else {
        pending.push({ id: depId, status: "not_found" });
      }
    }

    return {
      total: deps.length,
      satisfied,
      pending,
      allSatisfied: satisfied === deps.length,
    };
  }
}
