/**
 * ECC Rule Loader
 * 
 * 负责加载、索引和检索 ECC 规则库。
 * 支持按语言、框架和领域动态加载相关规则。
 */

import * as fs from "fs";
import * as path from "path";

export interface ECCRule {
  id: string;           // 规则唯一标识，如 "typescript/coding-style"
  language?: string;    // 编程语言，如 "typescript", "python"
  category: string;     // 规则类别，如 "coding-style", "security", "testing"
  title: string;        // 规则标题
  content: string;      // 规则内容（Markdown）
  priority: number;     // 优先级（1-10，10 最高）
  tags: string[];       // 标签，用于快速检索
}

export interface ECCAgent {
  id: string;           // 代理唯一标识，如 "typescript-reviewer"
  name: string;         // 代理名称
  description: string;  // 代理描述
  content: string;      // 代理定义（Markdown）
  tools: string[];      // 代理可用工具
  model?: string;       // 推荐模型
}

export interface AgentMatchResult {
  agent: ECCAgent;
  score: number;
  matchedKeywords: string[];
  matchType: "exact" | "keyword-fuzzy" | "description-bm25" | "tool-match";
}

/**
 * ECC 规则加载器
 */
export class ECCRuleLoader {
  private rulesDir: string;
  private agentsDir: string;
  private rules: Map<string, ECCRule> = new Map();
  private agents: Map<string, ECCAgent> = new Map();
  private initialized = false;

  constructor(eccAssetsDir: string = path.join(process.cwd(), "ecc-assets")) {
    this.rulesDir = path.join(eccAssetsDir, "rules");
    this.agentsDir = path.join(eccAssetsDir, "agents");
  }

  /**
   * 初始化加载器，扫描所有规则和代理
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log(`📚 ECC Rule Loader: 初始化中...`);

    // 加载规则
    await this.loadRules();
    console.log(`   ✅ 加载 ${this.rules.size} 条规则`);

    // 加载代理
    await this.loadAgents();
    console.log(`   ✅ 加载 ${this.agents.size} 个代理`);

    this.initialized = true;
  }

  /**
   * 加载所有规则
   */
  private async loadRules(): Promise<void> {
    if (!fs.existsSync(this.rulesDir)) {
      console.warn(`   ⚠️  规则目录不存在: ${this.rulesDir}`);
      return;
    }

    const entries = fs.readdirSync(this.rulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const langDir = path.join(this.rulesDir, entry.name);
      const files = fs.readdirSync(langDir).filter(f => f.endsWith(".md"));

      for (const file of files) {
        const filePath = path.join(langDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const category = file.replace(".md", "");
        
        const rule: ECCRule = {
          id: `${entry.name}/${category}`,
          language: entry.name === "common" ? undefined : entry.name,
          category,
          title: this.extractTitle(content),
          content,
          priority: this.calculatePriority(category),
          tags: this.extractTags(entry.name, category),
        };

        this.rules.set(rule.id, rule);
      }
    }
  }

  /**
   * 加载所有代理
   */
  private async loadAgents(): Promise<void> {
    if (!fs.existsSync(this.agentsDir)) {
      console.warn(`   ⚠️  代理目录不存在: ${this.agentsDir}`);
      return;
    }

    const files = fs.readdirSync(this.agentsDir).filter(f => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(this.agentsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const id = file.replace(".md", "");

      // 解析 YAML 前置元数据
      const metadata = this.parseYAMLFrontmatter(content);

      const agent: ECCAgent = {
        id,
        name: metadata.name || id,
        description: metadata.description || "",
        content,
        tools: metadata.tools || [],
        model: metadata.model,
      };

      this.agents.set(agent.id, agent);
    }
  }

  /**
   * 根据关键词检索相关规则
   */
  getRulesByKeywords(keywords: string[]): ECCRule[] {
    const matches: ECCRule[] = [];
    const keywordSet = new Set(keywords.map(k => k.toLowerCase()));

    for (const rule of this.rules.values()) {
      // 检查语言匹配
      if (rule.language && keywordSet.has(rule.language)) {
        matches.push(rule);
        continue;
      }

      // 检查标签匹配
      if (rule.tags.some(tag => keywordSet.has(tag))) {
        matches.push(rule);
        continue;
      }

      // 检查内容匹配
      const lowerContent = rule.content.toLowerCase();
      if (keywords.some(kw => lowerContent.includes(kw.toLowerCase()))) {
        matches.push(rule);
      }
    }

    // 按优先级排序
    return matches.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取特定语言的所有规则
   */
  getRulesByLanguage(language: string): ECCRule[] {
    const rules: ECCRule[] = [];

    // 先加入通用规则
    for (const rule of this.rules.values()) {
      if (!rule.language) {
        rules.push(rule);
      }
    }

    // 再加入语言特定规则
    for (const rule of this.rules.values()) {
      if (rule.language === language) {
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * 根据代理 ID 获取代理定义
   */
  getAgent(agentId: string): ECCAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 根据关键词匹配最合适的代理（v2 增强版）
   * 多信号评分：精确匹配 > 关键词覆盖 > 描述 BM25 > 工具匹配
   */
  matchAgent(keywords: string[]): ECCAgent | undefined {
    const scored = this.matchAgentScored(keywords);
    return scored.length > 0 ? scored[0].agent : undefined;
  }

  /**
   * 带评分的结果匹配（v2 新增）
   * 返回所有匹配的 Agent 按评分降序排列
   */
  matchAgentScored(keywords: string[]): AgentMatchResult[] {
    if (keywords.length === 0) return [];

    const keywordSet = new Set(keywords.map(k => k.toLowerCase()));
    const results: AgentMatchResult[] = [];

    for (const agent of this.agents.values()) {
      const agentIdLower = agent.id.toLowerCase();
      const agentKeywords = agent.id.split("-").map(k => k.toLowerCase());
      const agentDesc = (agent.name + " " + agent.description).toLowerCase();
      const agentTools = (agent.tools || []).map(t => t.toLowerCase());

      // Signal 1: 精确匹配（ID 完全匹配 → score 1.0）
      if (keywordSet.has(agentIdLower)) {
        results.push({
          agent,
          score: 1.0,
          matchedKeywords: [agent.id],
          matchType: "exact",
        });
        continue;
      }

      // Signal 2: 关键词覆盖度（ID 分词匹配 / 总关键词数）
      const matchedIdKeywords = agentKeywords.filter(ak => keywordSet.has(ak));
      const idCoverage = keywords.length > 0 ? matchedIdKeywords.length / keywords.length : 0;

      if (idCoverage >= 0.3) {
        results.push({
          agent,
          score: Math.min(0.9, 0.5 + idCoverage * 0.4),
          matchedKeywords: matchedIdKeywords,
          matchType: "keyword-fuzzy",
        });
        continue;
      }

      // Signal 3: 描述 BM25 匹配
      const descWords = agentDesc.split(/\s+/).filter(w => w.length > 2);
      const matchedDescWords = descWords.filter(dw => keywordSet.has(dw));
      const descScore = keywords.length > 0 ? matchedDescWords.length / keywords.length : 0;

      // Signal 4: 工具匹配
      const matchedTools = agentTools.filter(at => keywordSet.has(at));
      const toolScore = keywords.length > 0 ? matchedTools.length / keywords.length : 0;

      const combinedScore = Math.max(descScore * 0.6, toolScore * 0.4);

      if (combinedScore >= 0.2) {
        results.push({
          agent,
          score: Math.min(0.7, combinedScore),
          matchedKeywords: [...matchedDescWords, ...matchedTools],
          matchType: matchedTools.length > 0 ? "tool-match" : "description-bm25",
        });
      }
    }

    // 按评分降序排列
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 获取所有代理列表
   */
  listAgents(): ECCAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取所有规则列表
   */
  listRules(): ECCRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 提取 Markdown 标题
   */
  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : "未命名规则";
  }

  /**
   * 计算规则优先级
   */
  private calculatePriority(category: string): number {
    const priorities: Record<string, number> = {
      "security": 10,
      "testing": 9,
      "performance": 8,
      "coding-style": 7,
      "patterns": 6,
      "hooks": 5,
      "development-workflow": 4,
      "git-workflow": 3,
    };
    return priorities[category] || 5;
  }

  /**
   * 提取标签
   */
  private extractTags(language: string, category: string): string[] {
    const tags: string[] = [category];
    if (language !== "common") {
      tags.push(language);
    }
    return tags;
  }

  /**
   * 解析 YAML 前置元数据
   */
  private parseYAMLFrontmatter(content: string): Record<string, any> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const metadata: Record<string, any> = {};

    for (const line of yaml.split("\n")) {
      const [key, ...valueParts] = line.split(":");
      if (key && valueParts.length > 0) {
        const value = valueParts.join(":").trim();
        
        // 简单的 YAML 解析
        if (value.startsWith("[") && value.endsWith("]")) {
          try {
            metadata[key.trim()] = JSON.parse(value);
          } catch (e) {
            // 如果不是标准 JSON，尝试手动解析数组
            metadata[key.trim()] = value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
          }
        } else if (value === "true" || value === "false") {
          metadata[key.trim()] = value === "true";
        } else {
          metadata[key.trim()] = value.replace(/^["']|["']$/g, "");
        }
      }
    }

    return metadata;
  }
}

/**
 * 全局 ECC 规则加载器实例
 */
let globalLoader: ECCRuleLoader | null = null;

export function getECCRuleLoader(eccAssetsDir?: string): ECCRuleLoader {
  if (!globalLoader) {
    globalLoader = new ECCRuleLoader(eccAssetsDir);
  }
  return globalLoader;
}
