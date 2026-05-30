/**
 * Quality Manager — 代码/文档质量评估
 * 
 * 独立于 Risk Engine，专注产出物质量而非操作风险。
 */

import type { AgentAdapter } from "../../core/types.js";

export interface QualityCheck {
  name: string;
  description: string;
  /** 快速检查（不阻塞执行） */
  quick?: boolean;
}

export interface QualityReport {
  overall: "pass" | "warn" | "fail";
  checks: Array<{
    name: string;
    passed: boolean;
    score: number;       // 0-100
    details: string;
  }>;
  suggestions: string[];
}

const DEFAULT_CHECKS: QualityCheck[] = [
  { name: "type-safety", description: "TypeScript 类型完整性", quick: true },
  { name: "lint", description: "代码规范检查", quick: true },
  { name: "test-coverage", description: "测试覆盖率", quick: false },
  { name: "doc-completeness", description: "文档完整性", quick: true },
  { name: "error-handling", description: "错误处理规范", quick: true },
];

export class QualityManager {
  private checks: QualityCheck[];

  constructor(checks?: QualityCheck[]) {
    this.checks = checks || DEFAULT_CHECKS;
  }

  /**
   * 快速质量检查（只跑 quick: true 的检查项，不阻塞流程）
   */
  async quickCheck(adapter: AgentAdapter, workingDir: string): Promise<QualityReport> {
    const quickChecks = this.checks.filter(c => c.quick);
    const results: QualityReport["checks"] = [];
    const suggestions: string[] = [];

    for (const check of quickChecks) {
      const result = await this.runCheck(check, adapter, workingDir);
      results.push(result);
      if (!result.passed && result.score < 50) {
        suggestions.push(`[${check.name}] ${result.details}`);
      }
    }

    const allPassed = results.every(r => r.passed);
    const avgScore = results.reduce((s, r) => s + r.score, 0) / Math.max(results.length, 1);

    return {
      overall: allPassed ? "pass" : avgScore >= 50 ? "warn" : "fail",
      checks: results,
      suggestions,
    };
  }

  /**
   * 全面质量检查
   */
  async fullCheck(adapter: AgentAdapter, workingDir: string): Promise<QualityReport> {
    const results: QualityReport["checks"] = [];
    const suggestions: string[] = [];

    for (const check of this.checks) {
      const result = await this.runCheck(check, adapter, workingDir);
      results.push(result);
      if (!result.passed) {
        suggestions.push(`[${check.name}] ${result.details}`);
      }
    }

    const passed = results.filter(r => r.passed).length;
    const score = Math.round((passed / results.length) * 100);

    return {
      overall: score >= 80 ? "pass" : score >= 50 ? "warn" : "fail",
      checks: results,
      suggestions,
    };
  }

  private async runCheck(
    check: QualityCheck,
    adapter: AgentAdapter,
    workingDir: string
  ): Promise<QualityReport["checks"][0]> {
    const started = Date.now();
    let passed = true;
    let score = 100;
    let details = "";

    switch (check.name) {
      case "type-safety": {
        const result = await adapter.executeCommand("npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo 0", workingDir);
        const errCount = parseInt(result.output?.trim() || "0");
        passed = errCount === 0;
        score = Math.max(0, 100 - errCount * 10);
        details = passed ? "无类型错误" : `${errCount} 个类型错误`;
        break;
      }
      case "lint": {
        const result = await adapter.executeCommand("npx eslint . --format compact 2>&1 | wc -l | tr -d ' '", workingDir);
        const issueCount = parseInt(result.output?.trim() || "0");
        passed = issueCount <= 5;
        score = Math.max(0, 100 - issueCount * 5);
        details = passed ? `Lint 通过 (${issueCount} 条)` : `${issueCount} 条 lint 问题`;
        break;
      }
      case "test-coverage": {
        const result = await adapter.executeCommand(
          "npx jest --coverage --coverageReporters=text-summary 2>&1 | grep 'All files' | head -1", workingDir
        );
        if (result.success && result.output) {
          // 提取百分比
          const match = result.output.match(/(\d+\.?\d*)%/);
          score = match ? parseFloat(match[1]) : 0;
          passed = score >= 60;
          details = `覆盖率 ${score}%`;
        } else {
          score = 0;
          passed = false;
          details = "无法获取覆盖率（可能无测试）";
        }
        break;
      }
      case "doc-completeness": {
        // 检查关键文档是否存在
        const docs = ["README.md", "CONTRIBUTING.md"];
        let found = 0;
        for (const doc of docs) {
          const exists = await adapter.fileExists(`${workingDir}/${doc}`);
          if (exists) found++;
        }
        score = Math.round((found / docs.length) * 100);
        passed = score >= 50;
        details = `${found}/${docs.length} 核心文档存在`;
        break;
      }
      case "error-handling": {
        // 检查是否有裸 try-catch（没有 finally/log 的）
        const result = await adapter.executeCommand(
          "grep -r 'catch' --include='*.ts' . 2>/dev/null | wc -l | tr -d ' '", workingDir
        );
        const catchCount = parseInt(result.output?.trim() || "0");
        // 统计有完善错误处理的 catch
        const handledResult = await adapter.executeCommand(
          "grep -r 'catch.*{' --include='*.ts' . 2>/dev/null | grep -c 'console.error\\|logger.error\\|throw new' | tr -d ' ' || echo 0",
          workingDir
        );
        const handled = parseInt(handledResult.output?.trim() || "0");
        score = catchCount > 0 ? Math.round((handled / catchCount) * 100) : 100;
        passed = score >= 70;
        details = `${handled}/${catchCount} catch 块有错误处理`;
        break;
      }
    }

    return { name: check.name, passed, score, details };
  }

  /** 格式化质量报告 */
  formatReport(report: QualityReport): string {
    const lines = [`质量评估: ${report.overall.toUpperCase()}`];
    for (const c of report.checks) {
      lines.push(`  ${c.passed ? "✅" : "❌"} ${c.name}: ${c.score}% — ${c.details}`);
    }
    if (report.suggestions.length > 0) {
      lines.push("建议:");
      for (const s of report.suggestions) lines.push(`  ⚠️  ${s}`);
    }
    return lines.join("\n");
  }
}
