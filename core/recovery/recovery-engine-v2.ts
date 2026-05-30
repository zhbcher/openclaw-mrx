/**
 * Recovery Engine V2 — 六分支完整决策树
 * 
 * V1 只实现了 retry / replan / escalate。
 * V2 补完：alternative / skip + rollback 链路。
 * 
 * 决策树：
 *   执行失败
 *     ├── ESCALATE    严重错误（最先检查，不自动恢复）
 *     ├── RETRY       重试当前步骤（retryCount < maxRetries）
 *     ├── SKIP        跳过当前任务（非关键路径，重试耗尽）
 *     ├── ROLLBACK    回退到上一 checkpoint（有快照 + 重试耗尽）
 *     ├── ALTERNATIVE 换一种实现方式（目标可达，路径错误）
 *     ├── REPLAN      重新生成 DAG（方案根本错误）
 *     └── ESCALATE    暂停，请求人工介入（兜底）
 */

export type RecoveryVerdict = "retry" | "replan" | "rollback" | "alternative" | "skip" | "escalate" | "continue";

export interface RecoveryDecision {
  verdict: RecoveryVerdict;
  reason: string;
  nextAction: string;
  /** 建议的替代方案（仅 alternative 分支） */
  alternative?: string;
}

export interface ReflectionInput {
  /** 验证是否通过 */
  validationPassed: boolean;
  /** 当前重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 当前循环数 */
  iteration: number;
  /** 最大循环数 */
  maxIterations: number;
  /** 失败原因 */
  rootCause?: string;
  /** 严重程度 */
  severity: "low" | "medium" | "high" | "critical";
  /** 是否支持自愈 */
  selfHealingEnabled: boolean;
  /** 是否有可用 checkpoint */
  hasCheckpoint: boolean;
  /** 任务是否在关键路径上 */
  isCriticalPath: boolean;
}

export class RecoveryEngineV2 {
  /**
   * 根据执行结果和状态决定恢复策略
   */
  decide(input: ReflectionInput): RecoveryDecision {
    // 验证通过 → 继续
    if (input.validationPassed) {
      return {
        verdict: "continue",
        reason: "验证通过",
        nextAction: "推进到下一个任务",
      };
    }

    // === 决策树 ===

    // 分支 1: 低严重度 + 有重试配额 → RETRY
    if (input.severity !== "critical" && input.retryCount < input.maxRetries) {
      return {
        verdict: "retry",
        reason: `可重试错误（${input.retryCount + 1}/${input.maxRetries}）: ${input.rootCause || "未知错误"}`,
        nextAction: "重试当前任务，使用相同的实现方式",
      };
    }

    // 分支 2: 严重错误 → ESCALATE（最先检查，不自动恢复）
    if (input.severity === "critical") {
      return {
        verdict: "escalate",
        reason: `严重错误: ${input.rootCause || "未知"}`,
        nextAction: "暂停 Mission，等待人工介入",
      };
    }

    // 分支 3: 非关键路径 + 已重试耗尽 → SKIP
    if (!input.isCriticalPath && input.retryCount >= input.maxRetries) {
      return {
        verdict: "skip",
        reason: `非关键路径任务，重试 ${input.maxRetries} 次后跳过: ${input.rootCause || "未知错误"}`,
        nextAction: "跳过当前任务，标记为 skipped，继续后续任务",
      };
    }

    // 分支 4: 有 checkpoint → ROLLBACK
    if (input.hasCheckpoint && input.retryCount >= input.maxRetries) {
      return {
        verdict: "rollback",
        reason: `重试耗尽且有可用 checkpoint，回退到上一稳定状态`,
        nextAction: "回退到最近的 checkpoint，从该状态继续",
      };
    }

    // 分支 4: 支持自愈 → ALTERNATIVE（换策略）
    if (input.selfHealingEnabled && input.retryCount >= input.maxRetries) {
      return {
        verdict: "alternative",
        reason: `当前方案失败，尝试替代实现方式: ${input.rootCause || "未知错误"}`,
        nextAction: "生成替代方案并重试",
        alternative: "使用不同的技术实现路径",
      };
    }

    // 分支 5: 接近上限 → ESCALATE
    if (input.iteration >= input.maxIterations * 0.8) {
      return {
        verdict: "escalate",
        reason: `循环接近上限 (${input.iteration}/${input.maxIterations})，需要人工决策`,
        nextAction: "暂停 Mission，通知人工介入",
      };
    }

    // 分支 7: 兜底 REPLAN
    if (input.selfHealingEnabled) {
      return {
        verdict: "replan",
        reason: `自动重新规划: ${input.rootCause || "未知错误"}`,
        nextAction: "重新生成任务 DAG",
      };
    }

    // 最终兜底
    return {
      verdict: "escalate",
      reason: `无法自动恢复: ${input.rootCause || "未知错误"}`,
      nextAction: "暂停 Mission，等待人工介入",
    };
  }

  /**
   * 判断是否需要在执行前征求人工意见
   */
  needsApproval(verdict: RecoveryVerdict): boolean {
    return verdict === "escalate";
  }

  /**
   * 格式化决策摘要
   */
  formatDecision(d: RecoveryDecision): string {
    const icons: Record<RecoveryVerdict, string> = {
      retry: "🔄", alternative: "🔀", replan: "📋",
      rollback: "⏪", skip: "⏭️", escalate: "🆘", continue: "✅",
    };
    return `${icons[d.verdict]} ${d.verdict.toUpperCase()}: ${d.reason} → ${d.nextAction}`;
  }
}
