/**
 * @deprecated 请使用 RecoveryEngineV2（core/recovery/recovery-engine-v2.ts）
 *   V2 支持 6 分支决策树（critical 优先），Loop Engine 已接入 V2。
 */

import type { JudgementVerdict } from "../types.js";
import type { ReflectionResult } from "../reflector/reflector.js";
import type { MissionConfig } from "../types.js";

export interface RecoveryDecision {
  verdict: JudgementVerdict;
  reason: string;
  next_action: string;
}

export class RecoveryEngine {
  private config: MissionConfig;

  constructor(config: MissionConfig) {
    this.config = config;
  }

  /**
   * 根据反思结果决定恢复策略
   */
  decide(
    reflection: ReflectionResult,
    retryCount: number,
    maxRetries: number,
    iteration: number
  ): RecoveryDecision {
    // 验证通过 → 继续
    if (reflection.confidence === 1.0 && !reflection.should_retry && !reflection.should_replan) {
      return {
        verdict: "continue",
        reason: "验证通过，继续执行",
        next_action: "推进到下一个 DAG 节点",
      };
    }

    const maxIterations = this.config.budget.max_iterations;

    // === 决策树 ===

    // 分支 1: 可重试的临时错误 → RETRY
    if (reflection.should_retry && retryCount < maxRetries) {
      return {
        verdict: "retry",
        reason: `${reflection.root_cause} — 重试 (${retryCount + 1}/${maxRetries})`,
        next_action: `重试当前任务: ${reflection.suggestion}`,
      };
    }

    // 分支 2: 需要换方案 → REPLAN
    if (reflection.should_replan && retryCount >= maxRetries) {
      if (this.config.autonomy.self_healing) {
        return {
          verdict: "replan",
          reason: `${reflection.root_cause} — 重试耗尽，自动重新规划`,
          next_action: `重新生成 DAG 并排除失败方案`,
        };
      }
    }

    // 分支 3: 循环次数接近上限 → ASK_HUMAN
    if (iteration >= maxIterations * 0.8) {
      return {
        verdict: "escalate",
        reason: `循环次数接近上限 (${iteration}/${maxIterations})，需要人工决策`,
        next_action: "暂停 Mission，等待人工介入",
      };
    }

    // 分支 4: CRITICAL 错误 → ASK_HUMAN
    if (reflection.severity === "critical") {
      return {
        verdict: "escalate",
        reason: `严重错误: ${reflection.root_cause}`,
        next_action: "暂停 Mission，等待人工介入",
      };
    }

    // 分支 5: 重试耗尽且不支持自愈 → ASK_HUMAN
    if (retryCount >= maxRetries && !this.config.autonomy.self_healing) {
      return {
        verdict: "escalate",
        reason: `重试 ${maxRetries} 次失败: ${reflection.root_cause}`,
        next_action: `建议: ${reflection.suggestion}`,
      };
    }

    // 分支 6: 兜底 → REPLAN
    return {
      verdict: "replan",
      reason: `${reflection.root_cause} — 自动重新规划`,
      next_action: "重新生成任务 DAG",
    };
  }

  /**
   * 检查是否需要人工介入
   */
  needsHumanIntervention(verdict: JudgementVerdict): boolean {
    return verdict === "escalate";
  }

  /**
   * 生成恢复摘要（供 checkpoint 记录）
   */
  summarize(decision: RecoveryDecision, reflection: ReflectionResult): string {
    return [
      `裁决: ${decision.verdict}`,
      `原因: ${decision.reason}`,
      `根因: ${reflection.root_cause}`,
      `严重程度: ${reflection.severity}`,
      `下一步: ${decision.next_action}`,
    ].join(" | ");
  }
}
