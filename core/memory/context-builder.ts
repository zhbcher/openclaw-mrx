/**
 * Context Builder — 将 Memory Recall 结果构建为可注入的上下文
 * 
 * 输出格式：结构化 Markdown 文本，注入到执行 Agent 的 system prompt 中。
 * 
 * ECC 增强：在 Memory 上下文尾部追加 ECC 规则知识（如果已注册 ECCContextBuilder）。
 */

import type { MemoryEntry } from "./memory-compiler.js";
import type { ECCContextBuilder } from "../ecc/ecc-context-builder.js";

export interface RecallResult {
  query: string;
  keywords: string[];
  entries: Array<{
    entry: MemoryEntry;
    relevanceScore: number;
  }>;
  totalFound: number;
  searchDurationMs: number;
}

export interface BuiltContext {
  /** 完整的 context 文本（注入 LLM prompt） */
  text: string;
  /** 上下文摘要（日志输出） */
  summary: string;
  /** 各类型命中数 */
  hits: {
    decisions: number;
    failures: number;
    solutions: number;
    patterns: number;
    knowledge: number;
  };
}

export class ContextBuilder {
  private eccBuilder: ECCContextBuilder | null = null;

  /**
   * 注册 ECC 上下文构建器（可选），使 Memory Recall 结果能自动补充 ECC 规则知识
   */
  setECCBuilder(builder: ECCContextBuilder | null): void {
    this.eccBuilder = builder;
  }

  /**
   * 构建上下文文本（同步版，向后兼容）
   * 不依赖 ECC 模块，等同于原始行为
   */
  build(result: RecallResult, maxEntries: number = 5): BuiltContext {
    return this.buildBase(result, maxEntries);
  }

  /**
   * 构建上下文文本（ECC 增强版）
   * 当有 ECCContextBuilder 注册且查询命中 Memory 条目时，自动补充 ECC 规则知识
   */
  async buildWithECC(result: RecallResult, maxEntries: number = 5): Promise<BuiltContext> {
    const base = this.buildBase(result, maxEntries);
    
    // ECC 增强：如果 Memory 有命中且 ECC 模块可用，追加 ECC 规则知识
    if (this.eccBuilder && result.entries.length > 0) {
      try {
        const keywords = result.keywords.length > 0 ? result.keywords : this.extractKeywords(result.query);
        const enriched = await this.eccBuilder.buildEnhancedContext(
          base.text,
          result.query,
          keywords
        );
        
        if (enriched.hits.rules > 0) {
          return {
            text: base.text + "\n\n" + enriched.text,
            summary: base.summary + " | ECC: " + enriched.summary,
            hits: {
              ...base.hits,
            },
          };
        }
      } catch (err) {
        // ECC 增强失败不影响主流程
      }
    }
    
    return base;
  }

  /**
   * 原始构建逻辑（同步，不依赖 ECC）
   */
  private buildBase(result: RecallResult, maxEntries: number = 5): BuiltContext {
    const entries = result.entries.slice(0, maxEntries);
    
    if (entries.length === 0) {
      return {
        text: "",
        summary: "无相关历史经验",
        hits: { decisions: 0, failures: 0, solutions: 0, patterns: 0, knowledge: 0 },
      };
    }

    const hits = {
      decisions: 0, failures: 0, solutions: 0, patterns: 0, knowledge: 0,
    };

    const sections: string[] = [];
    sections.push("## 历史经验参考\n");

    // 按重要性和类型分组
    const failures = entries.filter(e => e.entry.type === "failure");
    const solutions = entries.filter(e => e.entry.type === "solution");
    const decisions = entries.filter(e => e.entry.type === "decision");
    const patterns = entries.filter(e => e.entry.type === "pattern");
    const knowledge = entries.filter(e => e.entry.type === "knowledge");

    // 失败教训优先（最重要）
    if (failures.length > 0) {
      hits.failures = failures.length;
      sections.push("### ⚠️ 历史失败教训\n");
      for (const item of failures) {
        sections.push(`- **${item.entry.title}** (相关性: ${(item.relevanceScore * 100).toFixed(0)}%)`);
        sections.push(`  ${item.entry.content.slice(0, 200)}`);
        sections.push("");
      }
    }

    // 解决方案
    if (solutions.length > 0) {
      hits.solutions = solutions.length;
      sections.push("### 💡 可复用方案\n");
      for (const item of solutions) {
        sections.push(`- **${item.entry.title}**`);
        sections.push(`  ${item.entry.content.slice(0, 200)}`);
        sections.push("");
      }
    }

    // 关键决策
    if (decisions.length > 0) {
      hits.decisions = decisions.length;
      sections.push("### 🧭 相关决策\n");
      for (const item of decisions) {
        sections.push(`- **${item.entry.title}**`);
        sections.push(`  ${item.entry.content.slice(0, 150)}`);
        sections.push("");
      }
    }

    // 模式识别
    if (patterns.length > 0) {
      hits.patterns = patterns.length;
      sections.push("### 🔄 识别到的模式\n");
      for (const item of patterns) {
        sections.push(`- ${item.entry.title}`);
        sections.push("");
      }
    }

    // 项目知识
    if (knowledge.length > 0) {
      hits.knowledge = knowledge.length;
      sections.push("### 📚 项目知识\n");
      for (const item of knowledge) {
        sections.push(`- ${item.entry.title}`);
        sections.push(`  ${item.entry.content.slice(0, 150)}`);
        sections.push("");
      }
    }

    sections.push("---");
    sections.push("以上是历史经验。请在执行当前任务时参考这些经验，避免重复已知错误。");

    const text = sections.join("\n");
    const summary = `找到 ${result.totalFound} 条相关记忆 (失败:${hits.failures} 方案:${hits.solutions} 决策:${hits.decisions} 模式:${hits.patterns} 知识:${hits.knowledge})`;

    return { text, summary, hits };
  }

  /**
   * 构建紧凑版上下文 (同步，不依赖 ECC)
   */
  buildCompact(result: RecallResult, maxEntries: number = 3): string {
    const entries = result.entries.slice(0, maxEntries);
    if (entries.length === 0) return "";

    const lines = ["[历史经验]" ];
    for (const item of entries) {
      const typeLabel = item.entry.type === "failure" ? "❌" :
        item.entry.type === "solution" ? "💡" :
        item.entry.type === "decision" ? "🧭" : "📝";
      lines.push(`${typeLabel} ${item.entry.title}: ${item.entry.content.slice(0, 120)}`);
    }
    return lines.join("\n");
  }

  /**
   * 从查询文本中提取关键词
   */
  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2 && !["the", "and", "for", "with", "this", "that", "from"].includes(w));
    
    const langKeywords = ["typescript", "javascript", "python", "go", "rust", "java",
      "kotlin", "swift", "cpp", "csharp", "ruby", "php", "react", "angular", "vue"];
    const detected = langKeywords.filter(lk => words.includes(lk) || text.toLowerCase().includes(lk));
    
    return [...new Set([...detected, ...words])].slice(0, 10);
  }
}
