/**
 * Memory Recall Engine — 任务开始前自动检索历史经验
 * 
 * 这是 MRX 从"只写记忆"变成"读写记忆"的核心模块。
 * 
 * 流程：
 *   Task 开始
 *     ↓
 *   KeywordExtractor 提取关键词
 *     ↓
 *   SearchMemory 检索（本地文件 + 未来 QMD）
 *     ↓
 *   Rank & Filter 排序过滤
 *     ↓
 *   ContextBuilder 构建上下文
 *     ↓
 *   注入执行上下文
 */

import * as fs from "fs";
import * as path from "path";
import { KeywordExtractor } from "./keyword-extractor.js";
import { ContextBuilder, type RecallResult, type BuiltContext } from "./context-builder.js";
import { QmdLiteClient } from "./qmd-lite-client.js";
import type { MemoryEntry } from "./memory-compiler.js";

export interface RecallOptions {
  /** 最大返回条目数 */
  maxResults?: number;
  /** 最低相关性分数（0-1） */
  minScore?: number;
  /** 是否在日志中显示召回详情 */
  verbose?: boolean;
}

export class RecallEngine {
  private keywordExtractor: KeywordExtractor;
  private contextBuilder: ContextBuilder;
  private memoryDir: string;
  private qmdClient: QmdLiteClient | null;

  constructor(memoryDir: string, qmdIndexPath?: string) {
    this.keywordExtractor = new KeywordExtractor();
    this.contextBuilder = new ContextBuilder();
    this.memoryDir = memoryDir;
    
    // QMD Lite: 如果提供了 QMD 索引路径，启用双源检索
    const qmdPath = qmdIndexPath || path.join(process.cwd(), "memory", "mrx");
    this.qmdClient = fs.existsSync(qmdPath) ? new QmdLiteClient(qmdPath) : null;
  }

  /**
   * 核心方法：根据任务描述召回相关历史经验
   */
  async recall(
    taskDescription: string,
    objectiveTitle: string,
    options: RecallOptions = {}
  ): Promise<{ built: BuiltContext; raw: RecallResult }> {
    const { maxResults = 5, minScore = 0.1, verbose = true } = options;
    const startedAt = Date.now();

    // 1. 提取关键词
    const keywords = this.keywordExtractor.extract(
      `${objectiveTitle} ${taskDescription}`,
      8
    );

    if (verbose) {
      console.log(`  🧠 Memory Recall: 关键词 = [${keywords.join(", ")}]`);
    }

    // 2. 搜索记忆库（本地文件 + QMD 索引）
    const localEntries = this.loadAllMemories();
    
    // QMD 双源检索
    let qmdEntries: MemoryEntry[] = [];
    if (this.qmdClient) {
      const qmdResults = this.qmdClient.search(keywords, {
        maxResults: 20,
        minScore: 0.05,
      });
      qmdEntries = qmdResults.map(r => r.entry);
    }

    // 合并去重（按 title 去重，保留更高置信度的）
    const allEntries = this.mergeDedupe(localEntries, qmdEntries);
    const scored = this.scoreAndRank(allEntries, keywords, minScore);

    // 3. 构建结果
    const raw: RecallResult = {
      query: `${objectiveTitle} — ${taskDescription}`,
      keywords,
      entries: scored.slice(0, maxResults),
      totalFound: allEntries.length,
      searchDurationMs: Date.now() - startedAt,
    };

    // 4. 构建上下文
    const built = this.contextBuilder.build(raw, maxResults);

    if (verbose && built.summary !== "无相关历史经验") {
      const source = this.qmdClient ? "本地+QMD" : "本地";
      console.log(`  🧠 [${source}] ${built.summary}`);
      if (raw.entries.length > 0) {
        const top = raw.entries[0];
        console.log(`    🔝 Top: [${top.entry.type}] ${top.entry.title} (${(top.relevanceScore * 100).toFixed(0)}%)`);
      }
    }

    return { built, raw };
  }

  /**
   * 快速召回（不输出日志）
   */
  async recallQuick(taskDescription: string, objectiveTitle: string): Promise<BuiltContext> {
    const { built } = await this.recall(taskDescription, objectiveTitle, {
      maxResults: 3,
      verbose: false,
    });
    return built;
  }

  // ============================================================
  // 内部：记忆加载
  // ============================================================

  /**
   * 从 Memory Compiler 输出目录加载所有记忆
   * 
   * Walking Skeleton 阶段：直接读取文件系统
   * 下一阶段：通过 QMD Lite 客户端
   */
  private loadAllMemories(): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    if (!fs.existsSync(this.memoryDir)) {
      return entries;
    }

    // 遍历所有 mission 子目录
    const missionDirs = fs.readdirSync(this.memoryDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of missionDirs) {
      const missionPath = path.join(this.memoryDir, dir.name);
      // 文件名为复数，类型须 normalize 为单数
      const typeFiles: Array<{ file: string; type: string }> = [
        { file: "decisions.md", type: "decision" },
        { file: "failures.md", type: "failure" },
        { file: "solutions.md", type: "solution" },
        { file: "patterns.md", type: "pattern" },
        { file: "knowledge.md", type: "knowledge" },
      ];

      for (const { file, type } of typeFiles) {
        const filePath = path.join(missionPath, file);
        if (!fs.existsSync(filePath)) continue;

        try {
          const parsed = this.parseMemoryFile(filePath, type, dir.name);
          entries.push(...parsed);
        } catch {
          // 解析失败静默跳过
        }
      }
    }

    return entries;
  }

  /**
   * 解析 Memory Compiler 输出的 Markdown 文件
   */
  private parseMemoryFile(filePath: string, type: string, missionId: string): MemoryEntry[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const entries: MemoryEntry[] = [];

    // 按 ## 标题分割
    const sections = content.split(/^## /m).filter(s => s.trim());
    
    for (const section of sections) {
      const lines = section.split("\n");
      const title = lines[0].trim();
      if (!title || title.startsWith("#")) continue;

      // 提取元数据
      let tags: string[] = [];
      let confidence = 0.7;
      let timestamp = new Date().toISOString();
      const contentLines: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- **标签**:")) {
          tags = line.replace("- **标签**:", "").trim().split(",").map(t => t.trim());
        } else if (line.startsWith("- **可信度**:")) {
          const pct = parseInt(line.replace("- **可信度**:", "").trim());
          confidence = isNaN(pct) ? 0.7 : pct / 100;
        } else if (line.startsWith("- **时间**:")) {
          timestamp = line.replace("- **时间**:", "").trim();
        } else if (line && !line.startsWith("---") && !line.startsWith("- **")) {
          contentLines.push(line);
        }
      }

      const validTypes = ["decision", "failure", "solution", "pattern", "knowledge"];
      const entryType = validTypes.includes(type) ? type as MemoryEntry["type"] : "knowledge";

      entries.push({
        id: `mem_${missionId}_${type}_${entries.length}`,
        type: entryType,
        mission_id: missionId,
        timestamp,
        title,
        content: contentLines.join("\n").trim(),
        tags,
        confidence,
      });
    }

    return entries;
  }

  // ============================================================
  // 内部：合并与去重
  // ============================================================

  /**
   * 合并本地文件 + QMD 索引的记忆，按 title 去重（保留置信度更高的）
   */
  private mergeDedupe(local: MemoryEntry[], qmd: MemoryEntry[]): MemoryEntry[] {
    const seen = new Map<string, MemoryEntry>();

    for (const entry of [...local, ...qmd]) {
      const key = entry.title.toLowerCase();
      const existing = seen.get(key);
      if (!existing || entry.confidence > existing.confidence) {
        seen.set(key, entry);
      }
    }

    return [...seen.values()];
  }

  // ============================================================
  // 内部：评分与排序
  // ============================================================

  /**
   * BM25-inspired 评分 + 排序
   */
  private scoreAndRank(
    entries: MemoryEntry[],
    keywords: string[],
    minScore: number
  ): Array<{ entry: MemoryEntry; relevanceScore: number }> {
    const scored = entries.map(entry => {
      const searchText = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
      
      // 关键词命中评分
      let keywordScore = 0;
      for (const kw of keywords) {
        const lowerKw = kw.toLowerCase();
        // 精确匹配（完整词）
        const exactMatches = (searchText.match(new RegExp(lowerKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
        keywordScore += exactMatches * 2;
        
        // 部分匹配（子串）
        if (searchText.includes(lowerKw)) {
          keywordScore += 0.5;
        }
      }

      // 标题命中加分
      const titleLower = entry.title.toLowerCase();
      let titleBonus = 0;
      for (const kw of keywords) {
        if (titleLower.includes(kw.toLowerCase())) {
          titleBonus += 3;
        }
      }

      // 类型权重
      const typeWeight = {
        failure: 1.5,    // 失败教训最重要
        solution: 1.3,   // 解决方案次之
        pattern: 1.1,    // 模式识别
        decision: 1.0,   // 决策记录
        knowledge: 0.8,  // 普通知识
      }[entry.type] || 1.0;

      // 新鲜度衰减（越新的记忆权重越高）
      const ageInDays = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      const freshnessBoost = Math.max(0.5, 1.0 - ageInDays / 30); // 30天后衰减到 0.5

      const rawScore = (keywordScore + titleBonus) * typeWeight * freshnessBoost * entry.confidence;
      
      // Sigmoid 归一化到 [0, 1]
      const normalizedScore = rawScore / (rawScore + 5);

      return { entry, relevanceScore: Math.round(normalizedScore * 100) / 100 };
    });

    // 过滤低分 + 排序
    return scored
      .filter(s => s.relevanceScore >= minScore)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
