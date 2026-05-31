/**
 * ECC Context Enricher
 * 
 * 增强 MRX 的 ContextBuilder，在构造执行上下文时注入 ECC 规则和知识。
 */

import { ECCRuleLoader, ECCRule, ECCAgent } from "./rule-loader.js";

export interface EnrichedContext {
  text: string;
  summary: string;
  rules: ECCRule[];
  agent?: ECCAgent;
  hits: {
    decisions: number;
    failures: number;
    solutions: number;
    patterns: number;
    knowledge: number;
    rules: number;
  };
}

/**
 * ECC 上下文增强器
 */
export class ECCContextEnricher {
  private loader: ECCRuleLoader;

  constructor(loader: ECCRuleLoader) {
    this.loader = loader;
  }

  /**
   * 根据任务关键词增强上下文
   */
  async enrichContext(
    baseContext: string,
    taskDescription: string,
    keywords: string[]
  ): Promise<EnrichedContext> {
    // 提取相关规则
    const rules = this.loader.getRulesByKeywords(keywords);
    const topRules = rules.slice(0, 5); // 取前 5 条最相关的规则

    // 匹配合适的代理
    const agent = this.loader.matchAgent(keywords);

    // 构建增强的上下文
    const sections: string[] = [];

    // 1. 基础上下文
    if (baseContext) {
      sections.push(baseContext);
      sections.push("");
    }

    // 2. ECC 代理指导（如果匹配）
    if (agent) {
      sections.push("## 🤖 ECC 代理指导\n");
      sections.push(`**代理**: ${agent.name}`);
      sections.push(`**描述**: ${agent.description}`);
      sections.push(`**可用工具**: ${agent.tools.join(", ") || "无"}`);
      sections.push("");

      // 提取代理的关键指导
      const guidance = this.extractAgentGuidance(agent.content);
      if (guidance) {
        sections.push(guidance);
        sections.push("");
      }
    }

    // 3. ECC 核心规则
    if (topRules.length > 0) {
      sections.push("## 📋 ECC 核心规则与标准\n");
      
      for (const rule of topRules) {
        sections.push(`### ${rule.title} (${rule.id})\n`);
        
        // 提取规则的关键部分
        const summary = this.extractRuleSummary(rule.content);
        sections.push(summary);
        sections.push("");
      }
    }

    // 4. 执行指导
    sections.push("---");
    sections.push("## 执行指导\n");
    sections.push("在执行当前任务时，请：");
    sections.push("1. 参考上述 ECC 规则和标准");
    if (agent) {
      sections.push(`2. 遵循 ${agent.name} 代理的指导原则`);
    }
    sections.push("3. 避免重复已知错误和反模式");

    const text = sections.join("\n");
    const summary = `ECC 增强上下文: ${topRules.length} 条规则${agent ? `, 代理: ${agent.name}` : ""}`;

    return {
      text,
      summary,
      rules: topRules,
      agent,
      hits: {
        decisions: 0,
        failures: 0,
        solutions: 0,
        patterns: 0,
        knowledge: 0,
        rules: topRules.length,
      },
    };
  }

  /**
   * 提取代理的关键指导
   */
  private extractAgentGuidance(content: string): string {
    // 查找 "Prompt Defense Baseline" 或 "Review Priorities" 部分
    const sections: string[] = [];

    // 提取 Prompt Defense Baseline
    const defenseMatch = content.match(/## Prompt Defense Baseline\n([\s\S]*?)(?=\n##|$)/);
    if (defenseMatch) {
      sections.push("### 防御基线\n");
      sections.push(defenseMatch[1].split("\n").slice(0, 5).join("\n"));
    }

    // 提取 Review Priorities
    const prioritiesMatch = content.match(/## Review Priorities\n([\s\S]*?)(?=\n##|$)/);
    if (prioritiesMatch) {
      sections.push("### 审查优先级\n");
      const lines = prioritiesMatch[1].split("\n");
      sections.push(lines.slice(0, 10).join("\n"));
    }

    return sections.join("\n");
  }

  /**
   * 提取规则的摘要
   */
  private extractRuleSummary(content: string): string {
    // 提取前 500 字符或第一个主要部分
    const lines = content.split("\n");
    const summary: string[] = [];
    let charCount = 0;
    const maxChars = 500;

    for (const line of lines) {
      if (line.startsWith("#")) continue; // 跳过标题
      if (charCount > maxChars) break;

      summary.push(line);
      charCount += line.length;
    }

    return summary.join("\n").trim();
  }

  /**
   * 为特定语言构建规则集
   */
  async buildLanguageRuleSet(language: string): Promise<string> {
    const rules = this.loader.getRulesByLanguage(language);
    const sections: string[] = [];

    sections.push(`# ${language} 规则集\n`);

    for (const rule of rules) {
      sections.push(`## ${rule.title}\n`);
      sections.push(rule.content);
      sections.push("");
    }

    return sections.join("\n");
  }
}
