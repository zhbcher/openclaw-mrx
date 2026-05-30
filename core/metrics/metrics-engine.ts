/**
 * Metrics Engine — 执行统计采集与报告
 * 
 * 基于 State Graph (SQLite) 的聚合查询，支持：
 *   - Objective 完成率
 *   - Task 成功/失败/重试统计
 *   - Checkpoint 密度
 *   - Token/时间/成本预算
 */

import { getDatabase } from "../../core/state-graph/database.js";

export interface MissionMetrics {
  missionId: string;
  objectiveTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number;
  
  // 任务统计
  tasks: {
    total: number;
    completed: number;
    failed: number;
    retrying: number;
    skipped: number;
    successRate: number;
  };
  
  // 检查点
  checkpoints: {
    count: number;
    lastAt: string | null;
  };
  
  // 恢复
  recovery: {
    retries: number;
    replans: number;
    rollbacks: number;
    alternatives: number;
    escalations: number;
  };
  
  // 预算
  budget: {
    tokensConsumed: number;
    tokensLimit: number;
    tokensPercent: number;
    costUsd: number;
    costLimit: number;
    costPercent: number;
  };
}

export interface GlobalMetrics {
  totalObjectives: number;
  totalMissions: number;
  completedMissions: number;
  failedMissions: number;
  overallSuccessRate: number;
  avgDurationMinutes: number;
  totalTokensConsumed: number;
  totalCostUsd: number;
  topFailureReasons: Array<{ reason: string; count: number }>;
}

export class MetricsEngine {
  private db = getDatabase();

  /**
   * 获取单个 Mission 的详细指标
   */
  getMissionMetrics(missionId: string): MissionMetrics | null {
    const mission = this.db.prepare("SELECT * FROM missions WHERE id = ?").get(missionId) as any;
    if (!mission) return null;

    const objective = this.db.prepare("SELECT title FROM objectives WHERE id = ?").get(mission.objective_id) as any;
    const tasks = this.getTaskStats(mission.objective_id);
    const checkpoints = this.getCheckpointStats(missionId);
    const recovery = this.getRecoveryStats(missionId);

    const startedAt = mission.created_at;
    const completedAt = mission.completed_at;
    const durationMinutes = completedAt
      ? Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000)
      : Math.round((Date.now() - new Date(startedAt).getTime()) / 60000);

    return {
      missionId,
      objectiveTitle: objective?.title || "unknown",
      status: mission.status,
      startedAt,
      completedAt,
      durationMinutes,
      tasks,
      checkpoints,
      recovery,
      budget: {
        tokensConsumed: mission.budget_tokens,
        tokensLimit: mission.max_tokens,
        tokensPercent: Math.round((mission.budget_tokens / mission.max_tokens) * 100),
        costUsd: mission.budget_cost,
        costLimit: mission.max_cost_usd,
        costPercent: Math.round((mission.budget_cost / mission.max_cost_usd) * 100),
      },
    };
  }

  /**
   * 全局汇总指标
   */
  getGlobalMetrics(): GlobalMetrics {
    const missions = this.db.prepare("SELECT * FROM missions").all() as any[];
    const totalMissions = missions.length;
    const completed = missions.filter(m => m.status === "completed").length;
    const failed = missions.filter(m => m.status === "failed").length;

    const durations = missions
      .filter(m => m.completed_at)
      .map(m => (new Date(m.completed_at).getTime() - new Date(m.created_at).getTime()) / 60000);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const totalTokens = missions.reduce((s, m) => s + (m.budget_tokens || 0), 0);
    const totalCost = missions.reduce((s, m) => s + (m.budget_cost || 0), 0);

    // 失败原因
    const failureReasons = new Map<string, number>();
    for (const m of missions) {
      if (m.last_error) {
        const reason = m.last_error.slice(0, 60);
        failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
      }
    }
    const topFailures = [...failureReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      totalObjectives: (this.db.prepare("SELECT COUNT(*) as c FROM objectives").get() as any).c,
      totalMissions,
      completedMissions: completed,
      failedMissions: failed,
      overallSuccessRate: totalMissions > 0 ? Math.round((completed / totalMissions) * 100) : 0,
      avgDurationMinutes: avgDuration,
      totalTokensConsumed: totalTokens,
      totalCostUsd: totalCost,
      topFailureReasons: topFailures,
    };
  }

  /**
   * 生成人类可读报告
   */
  formatMissionReport(metrics: MissionMetrics): string {
    const lines = [
      `═`.repeat(50),
      `📊 Mission 报告: ${metrics.objectiveTitle}`,
      `═`.repeat(50),
      `状态: ${metrics.status}`,
      `耗时: ${metrics.durationMinutes} 分钟`,
      ``,
      `📋 任务统计:`,
      `  总计: ${metrics.tasks.total} | 完成: ${metrics.tasks.completed} | 失败: ${metrics.tasks.failed}`,
      `  成功率: ${metrics.tasks.successRate}%`,
      ``,
      `📸 检查点: ${metrics.checkpoints.count} 个`,
      ``,
      `🔄 恢复统计:`,
      `  重试: ${metrics.recovery.retries} | 重规划: ${metrics.recovery.replans}`,
      `  回滚: ${metrics.recovery.rollbacks} | 替代方案: ${metrics.recovery.alternatives}`,
      `  升级: ${metrics.recovery.escalations}`,
      ``,
      `💰 预算:`,
      `  Token: ${metrics.budget.tokensConsumed.toLocaleString()} / ${metrics.budget.tokensLimit.toLocaleString()} (${metrics.budget.tokensPercent}%)`,
      `  成本: $${metrics.budget.costUsd.toFixed(2)} / $${metrics.budget.costLimit.toFixed(2)} (${metrics.budget.costPercent}%)`,
      `═`.repeat(50),
    ];
    return lines.join("\n");
  }

  formatGlobalReport(metrics: GlobalMetrics): string {
    const lines = [
      `═`.repeat(50),
      `📊 MRX 全局统计`,
      `═`.repeat(50),
      `Objectives: ${metrics.totalObjectives}`,
      `Missions: ${metrics.totalMissions} (完成: ${metrics.completedMissions}, 失败: ${metrics.failedMissions})`,
      `总成功率: ${metrics.overallSuccessRate}%`,
      `平均耗时: ${metrics.avgDurationMinutes} 分钟`,
      `Token 总消耗: ${metrics.totalTokensConsumed.toLocaleString()}`,
      `总成本: $${metrics.totalCostUsd.toFixed(2)}`,
    ];

    if (metrics.topFailureReasons.length > 0) {
      lines.push("", "🔥 高频失败原因:");
      for (const { reason, count } of metrics.topFailureReasons) {
        lines.push(`  ${count}x: ${reason}`);
      }
    }

    lines.push(`═`.repeat(50));
    return lines.join("\n");
  }

  // ============================================================
  // Private
  // ============================================================

  private getTaskStats(objectiveId: string): MissionMetrics["tasks"] {
    // 通过 goals 找到所有 tasks
    const goals = this.db.prepare("SELECT task_ids FROM goals WHERE objective_id = ?").all(objectiveId) as any[];
    const taskIds: string[] = [];
    for (const g of goals) {
      try {
        const ids = JSON.parse(g.task_ids);
        taskIds.push(...ids);
      } catch { /* skip */ }
    }

    if (taskIds.length === 0) {
      return { total: 0, completed: 0, failed: 0, retrying: 0, skipped: 0, successRate: 0 };
    }

    const placeholders = taskIds.map(() => "?").join(",");
    const tasks = this.db.prepare(
      `SELECT status, COUNT(*) as count FROM tasks WHERE id IN (${placeholders}) GROUP BY status`
    ).all(...taskIds) as any[];

    const statusMap: Record<string, number> = {};
    for (const t of tasks) statusMap[t.status] = t.count;

    const total = taskIds.length;
    const done = statusMap["done"] || 0;
    const failed = statusMap["failed"] || 0;
    const retrying = statusMap["retrying"] || 0;
    const skipped = statusMap["skipped"] || 0;

    return {
      total,
      completed: done,
      failed,
      retrying,
      skipped,
      successRate: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  private getCheckpointStats(missionId: string): MissionMetrics["checkpoints"] {
    const countRow = this.db.prepare(
      "SELECT COUNT(*) as c FROM checkpoints WHERE mission_id = ?"
    ).get(missionId) as any;

    const lastRow = this.db.prepare(
      "SELECT created_at FROM checkpoints WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(missionId) as any;

    return {
      count: countRow?.c || 0,
      lastAt: lastRow?.created_at || null,
    };
  }

  private getRecoveryStats(missionId: string): MissionMetrics["recovery"] {
    const events = this.db.prepare(
      "SELECT event_type, COUNT(*) as count FROM events WHERE mission_id = ? AND event_type LIKE 'recovery.%' GROUP BY event_type"
    ).all(missionId) as any[];

    const eventMap: Record<string, number> = {};
    for (const e of events) eventMap[e.event_type] = e.count;

    return {
      retries: eventMap["recovery.retry"] || 0,
      replans: eventMap["recovery.replan"] || 0,
      rollbacks: eventMap["recovery.rollback"] || 0,
      alternatives: eventMap["recovery.alternative"] || 0,
      escalations: eventMap["recovery.escalate"] || 0,
    };
  }
}
