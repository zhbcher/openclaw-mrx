/**
 * Reflector — 反思与学习
 * 
 * Phase 2 核心模块。分析失败原因，提出改进建议。
 * 规则引擎做基础归因，LLM 做深度策略分析。
 */

import type { VerificationRecord, ExecutionPlan } from "../types.js";
import type { LlmClient } from "../planner/dag-planner.js";

// ============================================================
// 反思结果
// ============================================================

export interface ReflectionResult {
  summary: string;
  root_cause: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestion: string;
  should_retry: boolean;
  should_replan: boolean;
  confidence: number;  // 0-1
}

// ============================================================
// 规则归因
// ============================================================

const FAILURE_PATTERNS: Array<{
  patterns: RegExp[];
  root_cause: string;
  suggestion: string;
  severity: ReflectionResult["severity"];
  should_retry: boolean;
}> = [
  {
    patterns: [/cannot find module/i, /module not found/i, /ENOENT/],
    root_cause: "依赖缺失或路径错误",
    suggestion: "检查 package.json 依赖，运行 npm install",
    severity: "medium",
    should_retry: true,
  },
  {
    patterns: [/type .* is not assignable/i, /Type.*not assignable/i],
    root_cause: "类型不匹配",
    suggestion: "修复类型定义或类型断言",
    severity: "medium",
    should_retry: true,
  },
  {
    patterns: [/syntax error/i, /unexpected token/i, /parse error/i],
    root_cause: "语法错误",
    suggestion: "检查代码语法，修复后重试",
    severity: "high",
    should_retry: true,
  },
  {
    patterns: [/timeout/i, /timed out/i, /ETIMEDOUT/],
    root_cause: "操作超时",
    suggestion: "增加超时时间或拆分大任务",
    severity: "medium",
    should_retry: true,
  },
  {
    patterns: [/permission denied/i, /EACCES/, /not permitted/],
    root_cause: "权限不足",
    suggestion: "检查文件/目录权限，或需要人工授权",
    severity: "critical",
    should_retry: false,
  },
  {
    patterns: [/out of memory/i, /heap limit/i, /allocation failed/i],
    root_cause: "内存不足",
    suggestion: "减少并行任务数或增加内存限制",
    severity: "high",
    should_retry: true,
  },
  {
    patterns: [/network/i, /connection refused/i, /ECONNREFUSED/],
    root_cause: "网络连接失败",
    suggestion: "检查网络连接和服务可用性",
    severity: "high",
    should_retry: true,
  },
  {
    patterns: [/conflict/i, /merge conflict/i],
    root_cause: "代码合并冲突",
    suggestion: "需要人工解决合并冲突",
    severity: "critical",
    should_retry: false,
  },
];

// ============================================================
// Reflector
// ============================================================

const REFLECT_SYSTEM_PROMPT = `你是一个工程故障分析专家。分析 Agent 执行失败的原因，给出改进建议。

输出 JSON 格式：
{
  "root_cause": "失败根本原因（一句话）",
  "severity": "low|medium|high|critical",
  "suggestion": "具体可操作的改进建议",
  "should_retry": true/false,
  "should_replan": true/false,
  "confidence": 0.0-1.0
}

判断标准：
- should_retry: 同样方案重试可能成功（临时性错误）
- should_replan: 需要换方案或拆解方式
- severity: low=可忽略 / medium=需修复 / high=可能扩散 / critical=需人工介入`;

export class Reflector {
  private llm?: LlmClient;

  constructor(llm?: LlmClient) {
    this.llm = llm;
  }

  /**
   * 反思本轮执行
   */
  async reflect(
    verification: VerificationRecord,
    plan: ExecutionPlan,
    taskDescription: string
  ): Promise<ReflectionResult> {
    // 验证通过 → 简单反思
    if (verification.passed) {
      return {
        summary: "本轮执行顺利，验证全部通过",
        root_cause: "无",
        severity: "low",
        suggestion: "继续执行下一任务",
        should_retry: false,
        should_replan: false,
        confidence: 1.0,
      };
    }

    // 验证失败 → 深度分析
    const ruleResult = this.ruleBasedAnalysis(verification);
    const result = ruleResult || await this.llmAnalysis(verification, plan, taskDescription);

    return {
      summary: `${verification.checks.filter(c => !c.passed).length}/${verification.checks.length} 项验证失败。根因: ${result.root_cause}`,
      ...result,
    };
  }

  /**
   * 规则引擎分析
   */
  private ruleBasedAnalysis(
    verification: VerificationRecord
  ): ReflectionResult | null {
    const failedChecks = verification.checks.filter(c => !c.passed);
    const allErrors = failedChecks
      .map(c => [c.error, c.output].filter(Boolean).join(" "))
      .join(" ");

    for (const pattern of FAILURE_PATTERNS) {
      if (pattern.patterns.some(p => p.test(allErrors))) {
        return {
          summary: "",
          root_cause: pattern.root_cause,
          severity: pattern.severity,
          suggestion: pattern.suggestion,
          should_retry: pattern.should_retry,
          should_replan: !pattern.should_retry,
          confidence: 0.8,
        };
      }
    }

    return null; // 规则未匹配，交给 LLM
  }

  /**
   * LLM 深度分析
   */
  private async llmAnalysis(
    verification: VerificationRecord,
    plan: ExecutionPlan,
    taskDescription: string
  ): Promise<Omit<ReflectionResult, "summary">> {
    if (!this.llm) {
      // 无 LLM，返回通用分析
      return {
        root_cause: "未知错误（无 LLM 可用）",
        severity: "medium",
        suggestion: "检查失败的命令输出，手动排查",
        should_retry: true,
        should_replan: false,
        confidence: 0.3,
      };
    }

    const failedChecks = verification.checks.filter(c => !c.passed);
    const errorDetails = failedChecks.map(c =>
      `命令: ${c.command}\n错误: ${c.error || "无错误输出"}\n输出: ${c.output || "无输出"}`
    ).join("\n---\n");

    const prompt = `任务: ${taskDescription}
执行计划: ${plan.steps.map(s => s.description).join(" → ")}
验证失败详情:
${errorDetails}`;

    try {
      const response = await this.llm.chat(prompt, REFLECT_SYSTEM_PROMPT);
      const json = this.extractJSON(response);
      return {
        root_cause: json.root_cause || "LLM 分析失败",
        severity: json.severity || "medium",
        suggestion: json.suggestion || "建议人工排查",
        should_retry: json.should_retry ?? true,
        should_replan: json.should_replan ?? false,
        confidence: json.confidence || 0.5,
      };
    } catch {
      return {
        root_cause: "LLM 分析异常",
        severity: "medium",
        suggestion: "检查错误日志，人工决策",
        should_retry: true,
        should_replan: false,
        confidence: 0.3,
      };
    }
  }

  private extractJSON(response: string): any {
    const match = response.match(/```json\s*([\s\S]*?)```/) ||
                  [null, response];
    return JSON.parse((match[1] || response).trim());
  }
}
