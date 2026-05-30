/**
 * Budget Guard — 运行时资源限制
 * 
 * 防止无限循环和资源耗尽：
 *   1. 最大循环次数
 *   2. 最大执行时间
 *   3. 最大 Token 消耗
 *   4. 最大失败次数
 */

export interface BudgetConfig {
  maxIterations: number;
  maxRuntimeMinutes: number;
  maxFailures: number;
  maxTokens: number;
  warningThreshold: number;   // 0.0 ~ 1.0，触发警告的百分比
}

export interface BudgetStatus {
  iterations: { current: number; limit: number; percent: number };
  runtime: { currentMinutes: number; limitMinutes: number; percent: number };
  failures: { current: number; limit: number; percent: number };
  tokens: { current: number; limit: number; percent: number };
  exceeded: boolean;
  exceededField?: string;
  shouldWarn: boolean;
  warnings: string[];
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxIterations: 50,
  maxRuntimeMinutes: 30,
  maxFailures: 10,
  maxTokens: 1_000_000,
  warningThreshold: 0.8,
};

export class BudgetGuard {
  private config: BudgetConfig;
  private startTime: number;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET, ...config };
    this.startTime = Date.now();
  }

  check(iteration: number, failureCount: number, tokensUsed: number): BudgetStatus {
    const runtimeMinutes = (Date.now() - this.startTime) / 60000;

    const iterPct = Math.round((iteration / this.config.maxIterations) * 100);
    const runtimePct = Math.round((runtimeMinutes / this.config.maxRuntimeMinutes) * 100);
    const failPct = Math.round((failureCount / this.config.maxFailures) * 100);
    const tokenPct = Math.round((tokensUsed / this.config.maxTokens) * 100);

    const warnings: string[] = [];
    const threshold = this.config.warningThreshold;

    if (iterPct / 100 >= threshold) warnings.push(`循环接近上限: ${iteration}/${this.config.maxIterations}`);
    if (runtimePct / 100 >= threshold) warnings.push(`运行时间接近上限: ${runtimeMinutes.toFixed(1)}/${this.config.maxRuntimeMinutes}min`);
    if (failPct / 100 >= threshold) warnings.push(`失败次数接近上限: ${failureCount}/${this.config.maxFailures}`);
    if (tokenPct / 100 >= threshold) warnings.push(`Token 接近上限: ${tokensUsed}/${this.config.maxTokens}`);

    let exceeded = false;
    let exceededField: string | undefined;

    if (iteration >= this.config.maxIterations) { exceeded = true; exceededField = "iterations"; }
    else if (runtimeMinutes >= this.config.maxRuntimeMinutes) { exceeded = true; exceededField = "runtime"; }
    else if (failureCount >= this.config.maxFailures) { exceeded = true; exceededField = "failures"; }
    else if (tokensUsed >= this.config.maxTokens) { exceeded = true; exceededField = "tokens"; }

    return {
      iterations: { current: iteration, limit: this.config.maxIterations, percent: iterPct },
      runtime: { currentMinutes: runtimeMinutes, limitMinutes: this.config.maxRuntimeMinutes, percent: runtimePct },
      failures: { current: failureCount, limit: this.config.maxFailures, percent: failPct },
      tokens: { current: tokensUsed, limit: this.config.maxTokens, percent: tokenPct },
      exceeded,
      exceededField,
      shouldWarn: warnings.length > 0,
      warnings,
    };
  }

  /** 重置计时器 */
  reset(): void {
    this.startTime = Date.now();
  }
}
