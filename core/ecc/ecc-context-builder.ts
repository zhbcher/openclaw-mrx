/**
 * ECC-Enhanced Context Builder
 * 
 * 扩展 MRX 的 ContextBuilder，集成 ECC 规则和代理指导。
 */

import { ECCRuleLoader, getECCRuleLoader } from "./rule-loader.js";
import { ECCContextEnricher } from "./context-enricher.js";

export interface ContextBuildResult {
  text: string;
  summary: string;
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
 * ECC 增强的上下文构建器
 */
export class ECCContextBuilder {
  private loader: ECCRuleLoader;
  private enricher: ECCContextEnricher;

  constructor(eccAssetsDir?: string) {
    this.loader = getECCRuleLoader(eccAssetsDir);
    this.enricher = new ECCContextEnricher(this.loader);
  }

  /**
   * 初始化加载器
   */
  async initialize(): Promise<void> {
    await this.loader.initialize();
  }

  /**
   * 构建增强的执行上下文
   */
  async buildEnhancedContext(
    baseContext: string,
    taskDescription: string,
    keywords: string[]
  ): Promise<ContextBuildResult> {
    // 使用 ECC 增强器
    const enriched = await this.enricher.enrichContext(
      baseContext,
      taskDescription,
      keywords
    );

    return {
      text: enriched.text,
      summary: enriched.summary,
      hits: enriched.hits,
    };
  }

  /**
   * 为特定语言和任务类型构建规则上下文
   */
  async buildRuleContext(language: string, taskType: string): Promise<string> {
    const keywords = [language, taskType];
    const rules = this.loader.getRulesByKeywords(keywords);

    const sections: string[] = [];
    sections.push(`## ${language} ${taskType} 规则\n`);

    for (const rule of rules.slice(0, 10)) {
      sections.push(`### ${rule.title}\n`);
      sections.push(rule.content);
      sections.push("");
    }

    return sections.join("\n");
  }

  /**
   * 获取推荐的代理
   */
  getRecommendedAgent(keywords: string[]) {
    return this.loader.matchAgent(keywords);
  }

  /**
   * 列出所有可用的代理
   */
  listAgents() {
    return this.loader.listAgents();
  }
}
