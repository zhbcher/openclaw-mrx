/**
 * Supervisor Agent — 审计与风控
 */

import { RiskEngine } from "../core/risk/risk-engine.js";
import { BudgetController } from "../core/budget/budget-controller.js";
import { MemoryCompiler } from "../core/memory/memory-compiler.js";
import type { MissionConfig, MissionState } from "../core/types.js";
import type { RiskAssessment } from "../core/risk/risk-engine.js";
import type { BudgetStatus } from "../core/budget/budget-controller.js";
import type { LlmClient } from "../core/planner/dag-planner.js";

export interface AuditReport {
  timestamp: string;
  risk_assessment: RiskAssessment[];
  budget_status: BudgetStatus;
  blocked_operations: string[];
  warnings: string[];
  requires_approval: boolean;
}

export class SupervisorAgent {
  private riskEngine: RiskEngine;
  private budgetController: BudgetController;
  private memoryCompiler?: MemoryCompiler;

  constructor(config: MissionConfig, memoryDir: string, llm?: LlmClient) {
    this.riskEngine = new RiskEngine(config);
    this.budgetController = new BudgetController(config);
    if (config.memory.compile_after) {
      this.memoryCompiler = new MemoryCompiler(memoryDir, llm);
    }
  }

  auditBeforeExecution(commands: string[], workingDir: string): AuditReport {
    const riskAssessment = this.riskEngine.assessBatch(commands, workingDir);
    const blocked = riskAssessment.filter((a: RiskAssessment) => a.blocked).map((a: RiskAssessment) => a.reason);
    const warnings = riskAssessment
      .filter((a: RiskAssessment) => a.action === "require_approval" || a.action === "warn")
      .map((a: RiskAssessment) => `${a.level}: ${a.reason}`);

    return {
      timestamp: new Date().toISOString(),
      risk_assessment: riskAssessment,
      budget_status: this.budgetController.check({
        budget_consumed: { tokens: 0, duration_minutes: 0, cost_usd: 0 },
      } as MissionState),
      blocked_operations: blocked,
      warnings,
      requires_approval: this.riskEngine.needsApproval(riskAssessment),
    };
  }

  checkBudget(state: MissionState): BudgetStatus {
    return this.budgetController.check(state);
  }

  hasBlockedOperations(audit: AuditReport): boolean {
    return audit.blocked_operations.length > 0;
  }

  async compileMemory(state: MissionState, config: MissionConfig): Promise<void> {
    if (this.memoryCompiler) {
      await this.memoryCompiler.compile(state, config);
    }
  }

  formatAuditReport(audit: AuditReport): string {
    const lines: string[] = [];
    if (audit.blocked_operations.length > 0) {
      lines.push(`⛔ 阻止的操作: ${audit.blocked_operations.join("; ")}`);
    }
    if (audit.warnings.length > 0) {
      lines.push(`⚠️  警告: ${audit.warnings.join("; ")}`);
    }
    if (audit.requires_approval) {
      lines.push(`🔐 需要人工审批`);
    }
    return lines.length > 0 ? lines.join("\n") : "审查通过，无风险";
  }

  get risk(): RiskEngine {
    return this.riskEngine;
  }

  get budget(): BudgetController {
    return this.budgetController;
  }
}
