/**
 * Budget Controller — 资源预算管控
 * 
 * 三层预算限制：
 *   Token 消耗 / 运行时间 / 费用
 * 
 * 80% 时警告，100% 时暂停。
 */

import type { MissionConfig, MissionState } from "../types.js";

export interface BudgetStatus {
  tokens: { used: number; max: number; percent: number };
  duration: { minutes: number; max_hours: number; percent: number };
  cost: { used: number; max: number; percent: number };
  warnings: string[];
  exceeded: boolean;
  should_warn: boolean;
}

export class BudgetController {
  private config: MissionConfig;
  private startTime: Date;

  constructor(config: MissionConfig) {
    this.config = config;
    this.startTime = new Date();
  }

  /**
   * 检查预算状态
   */
  check(state: MissionState): BudgetStatus {
    const consumed = state.budget_consumed;
    const budget = this.config.budget;
    const threshold = budget.warning_threshold;

    const tokensPercent = consumed.tokens / budget.max_tokens;
    const durationMinutes = (Date.now() - this.startTime.getTime()) / 60000;
    const durationPercent = durationMinutes / (budget.max_duration_hours * 60);
    const costPercent = consumed.cost_usd / budget.max_cost_usd;

    const warnings: string[] = [];
    let exceeded = false;

    if (tokensPercent >= 1) {
      warnings.push(`Token 预算已耗尽 (${consumed.tokens.toLocaleString()}/${budget.max_tokens.toLocaleString()})`);
      exceeded = true;
    } else if (tokensPercent >= threshold) {
      warnings.push(`Token 使用已达 ${Math.round(tokensPercent * 100)}%`);
    }

    if (durationPercent >= 1) {
      warnings.push(`运行时间已超限 (${Math.round(durationMinutes)}min/${budget.max_duration_hours * 60}min)`);
      exceeded = true;
    } else if (durationPercent >= threshold) {
      warnings.push(`运行时间已达 ${Math.round(durationPercent * 100)}%`);
    }

    if (costPercent >= 1) {
      warnings.push(`费用预算已耗尽 ($${consumed.cost_usd.toFixed(2)}/$${budget.max_cost_usd})`);
      exceeded = true;
    } else if (costPercent >= threshold) {
      warnings.push(`费用预算已达 ${Math.round(costPercent * 100)}%`);
    }

    return {
      tokens: {
        used: consumed.tokens,
        max: budget.max_tokens,
        percent: Math.round(tokensPercent * 100),
      },
      duration: {
        minutes: Math.round(durationMinutes),
        max_hours: budget.max_duration_hours,
        percent: Math.round(durationPercent * 100),
      },
      cost: {
        used: consumed.cost_usd,
        max: budget.max_cost_usd,
        percent: Math.round(costPercent * 100),
      },
      warnings,
      exceeded,
      should_warn: warnings.length > 0,
    };
  }

  /**
   * 格式化预算状态为人类可读字符串
   */
  format(status: BudgetStatus): string {
    const parts: string[] = [];
    if (status.tokens.percent > 0) parts.push(`Token: ${status.tokens.percent}%`);
    if (status.duration.percent > 0) parts.push(`时间: ${status.duration.percent}%`);
    if (status.cost.percent > 0) parts.push(`费用: ${status.cost.percent}%`);
    return parts.join(" | ") || "预算正常";
  }
}
