/**
 * ECC Verifier
 * 
 * 将 ECC 的验证模式集成到 MRX 的 VerifierChain 中。
 * 支持基于 ECC 规则的 LLM 审计和安全检查。
 */

import { ECCRuleLoader, ECCRule } from "./rule-loader.js";

/**
 * ECC 验证结果
 */
export interface ECCVerificationResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
  suggestions: string[];
  severity: "critical" | "high" | "medium" | "low";
}

/**
 * ECC 验证器
 */
export class ECCVerifier {
  private loader: ECCRuleLoader;
  private name = "ECC Rule Verifier";
  private description = "基于 ECC 规则的代码审计和验证";

  constructor(loader: ECCRuleLoader) {
    this.loader = loader;
  }

  /**
   * 根据 ECC 规则验证代码或输出
   */
  async verify(
    content: string,
    language: string,
    taskType: string = "review"
  ): Promise<ECCVerificationResult> {
    const keywords = [language, taskType];
    const rules = this.loader.getRulesByKeywords(keywords);

    const violations: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    let severity: "critical" | "high" | "medium" | "low" = "low";

    // 对每条规则进行检查
    for (const rule of rules.slice(0, 10)) {
      const check = this.checkRule(content, rule);
      
      if (!check.passed && check.violation) {
        violations.push(check.violation);
        
        // 更新严重程度
        if (rule.priority >= 9) {
          severity = "critical";
        } else if (rule.priority >= 7 && severity !== "critical") {
          severity = "high";
        } else if (rule.priority >= 5 && severity === "low") {
          severity = "medium";
        }
      }

      if (check.warning) {
        warnings.push(check.warning);
      }

      if (check.suggestion) {
        suggestions.push(check.suggestion);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      warnings,
      suggestions,
      severity,
    };
  }

  /**
   * 检查单条规则
   */
  private checkRule(
    content: string,
    rule: ECCRule
  ): {
    passed: boolean;
    violation?: string;
    warning?: string;
    suggestion?: string;
  } {
    // 基于规则类别进行检查
    switch (rule.category) {
      case "security":
        return this.checkSecurityRule(content, rule);
      case "coding-style":
        return this.checkCodingStyle(content, rule);
      case "testing":
        return this.checkTestingRule(content, rule);
      case "performance":
        return this.checkPerformanceRule(content, rule);
      default:
        return { passed: true };
    }
  }

  /**
   * 检查安全规则
   */
  private checkSecurityRule(
    content: string,
    rule: ECCRule
  ): {
    passed: boolean;
    violation?: string;
    warning?: string;
    suggestion?: string;
  } {
    const violations: string[] = [];

    // 检查常见安全问题
    const securityPatterns = [
      { pattern: /eval\s*\(/gi, issue: "使用 eval() 存在安全风险" },
      { pattern: /innerHTML\s*=/gi, issue: "直接设置 innerHTML 可能导致 XSS" },
      { pattern: /dangerouslySetInnerHTML/gi, issue: "使用 dangerouslySetInnerHTML 需要谨慎" },
      { pattern: /process\.env\.\w+/gi, issue: "访问环境变量需要验证" },
      { pattern: /hardcoded.*password|hardcoded.*secret|hardcoded.*key/gi, issue: "检测到可能的硬编码凭证" },
    ];

    for (const { pattern, issue } of securityPatterns) {
      if (pattern.test(content)) {
        violations.push(issue);
      }
    }

    return {
      passed: violations.length === 0,
      violation: violations.join("; ") || undefined,
      suggestion: "遵循 ECC 安全规则进行代码审查",
    };
  }

  /**
   * 检查编码风格
   */
  private checkCodingStyle(
    content: string,
    rule: ECCRule
  ): {
    passed: boolean;
    violation?: string;
    warning?: string;
    suggestion?: string;
  } {
    const warnings: string[] = [];

    // 检查常见风格问题
    const stylePatterns = [
      { pattern: /\bvar\s+/g, issue: "应使用 const 或 let 而不是 var" },
      { pattern: /==\s/g, issue: "应使用 === 而不是 ==" },
      { pattern: /console\.log/g, issue: "生产代码中不应包含 console.log" },
    ];

    for (const { pattern, issue } of stylePatterns) {
      if (pattern.test(content)) {
        warnings.push(issue);
      }
    }

    return {
      passed: warnings.length === 0,
      warning: warnings.join("; ") || undefined,
      suggestion: "遵循 ECC 编码风格指南",
    };
  }

  /**
   * 检查测试规则
   */
  private checkTestingRule(
    content: string,
    rule: ECCRule
  ): {
    passed: boolean;
    violation?: string;
    warning?: string;
    suggestion?: string;
  } {
    const warnings: string[] = [];

    // 检查测试覆盖
    if (!content.includes("test") && !content.includes("describe")) {
      warnings.push("未检测到测试代码");
    }

    if (!content.includes("expect") && !content.includes("assert")) {
      warnings.push("未检测到断言");
    }

    return {
      passed: warnings.length === 0,
      warning: warnings.join("; ") || undefined,
      suggestion: "遵循 ECC 测试标准",
    };
  }

  /**
   * 检查性能规则
   */
  private checkPerformanceRule(
    content: string,
    rule: ECCRule
  ): {
    passed: boolean;
    violation?: string;
    warning?: string;
    suggestion?: string;
  } {
    const warnings: string[] = [];

    // 检查性能问题
    if (content.match(/for\s*\(\s*.*\s*in\s+.*\)\s*{[\s\S]*?await/)) {
      warnings.push("检测到循环中的 await，可能导致性能问题");
    }

    if (content.match(/forEach\s*\(\s*async/)) {
      warnings.push("不应在 forEach 中使用 async");
    }

    return {
      passed: warnings.length === 0,
      warning: warnings.join("; ") || undefined,
      suggestion: "遵循 ECC 性能优化指南",
    };
  }

  /**
   * 获取验证器信息
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
    };
  }
}
