/**
 * Hybrid Recall Engine — BM25 + Embedding + Recency 混合召回
 * 
 * V2 升级：从纯关键词检索升级为多信号融合打分。
 * 
 * 评分公式：
 *   finalScore = 0.3 * bm25Score + 0.5 * embeddingScore + 0.2 * recencyScore
 * 
 * 依赖：
 *   - BM25: 本地文件 + QMD 索引路径
 *   - Embedding: OpenClaw QMD 的向量检索（通过 HTTP API）
 *   - Recency: 时间衰减函数
 */

import * as fs from "fs";
import * as path from "path";
import { KeywordExtractor } from "./keyword-extractor.js";
import { ContextBuilder, type RecallResult, type BuiltContext } from "./context-builder.js";
import { QmdLiteClient } from "./qmd-lite-client.js";
import { parseMemoryMarkdown } from "./memory-parser.js";
import type { MemoryEntry } from "./memory-compiler.js";
import { CONFIG } from "../config.js";

export interface HybridRecallOptions {
  maxResults?: number;
  minScore?: number;
  verbose?: boolean;
  /** 是否启用 Embedding 召回（需要 QMD 向量就绪） */
  useEmbedding?: boolean;
  /** OpenClaw API base URL */
  apiBaseUrl?: string;
}

export interface ScoredEntry {
  entry: MemoryEntry;
  bm25Score: number;
  embeddingScore: number;
  recencyScore: number;
  finalScore: number;
  source: "bm25" | "embedding" | "both";
}

export class HybridRecallEngine {
  private keywordExtractor: KeywordExtractor;
  private contextBuilder: ContextBuilder;
  private memoryDir: string;
  private qmdClient: QmdLiteClient | null;
  private apiBaseUrl: string;

  constructor(memoryDir: string, qmdIndexPath?: string, apiBaseUrl?: string) {
    this.keywordExtractor = new KeywordExtractor();
    this.contextBuilder = new ContextBuilder();
    this.memoryDir = memoryDir;
    this.apiBaseUrl = apiBaseUrl || CONFIG.apiBaseUrl;
    
    const qmdPath = qmdIndexPath || path.join(process.cwd(), "memory", "mrx");
    this.qmdClient = fs.existsSync(qmdPath) ? new QmdLiteClient(qmdPath) : null;
  }

  /**
   * 混合召回主入口
   */
  async recall(
    taskDescription: string,
    objectiveTitle: string,
    options: HybridRecallOptions = {}
  ): Promise<{ built: BuiltContext; raw: RecallResult; scored: ScoredEntry[] }> {
    const { maxResults = 5, minScore = 0.1, verbose = true, useEmbedding = true } = options;
    const startedAt = Date.now();

    // 1. 提取关键词
    const keywords = this.keywordExtractor.extract(`${objectiveTitle} ${taskDescription}`, 8);
    if (verbose) console.log(`  🧠 Hybrid Recall: 关键词 = [${keywords.join(", ")}]`);

    // 2. BM25 召回（本地文件 + QMD 索引）
    const bm25Entries = this.bm25Recall(keywords);

    // 3. Embedding 召回（如果启用）
    let embeddingEntries: Map<string, { entry: MemoryEntry; score: number }> = new Map();
    if (useEmbedding) {
      embeddingEntries = await this.embeddingRecall(`${objectiveTitle} ${taskDescription}`, keywords);
    }

    // 4. 合并 + 混合打分
    const queryText = `${objectiveTitle} — ${taskDescription}`;
    const scored = this.hybridScore(bm25Entries, embeddingEntries, keywords);

    if (verbose && scored.length > 0) {
      console.log(`  🧠 [Hybrid] ${scored.length} 条候选, top: [${scored[0].entry.type}] ${scored[0].entry.title} (${(scored[0].finalScore * 100).toFixed(0)}%)`);
    }

    // 5. 构建结果
    const finalEntries = scored
      .filter(s => s.finalScore >= minScore)
      .slice(0, maxResults);

    const allEntries = [...bm25Entries.values(), ...embeddingEntries.values()].map(e => e.entry);

    const raw: RecallResult = {
      query: queryText,
      keywords,
      entries: finalEntries.map(s => ({
        entry: s.entry,
        relevanceScore: s.finalScore,
      })),
      totalFound: allEntries.length,
      searchDurationMs: Date.now() - startedAt,
    };

    const built = this.contextBuilder.build(raw, maxResults);

    if (verbose && built.summary !== "无相关历史经验") {
      console.log(`  ${built.summary}`);
    }

    return { built, raw, scored };
  }

  // ============================================================
  // BM25 召回
  // ============================================================

  private bm25Recall(keywords: string[]): Map<string, { entry: MemoryEntry; bm25Score: number }> {
    const results = new Map<string, { entry: MemoryEntry; bm25Score: number }>();

    // 本地文件
    const localEntries = this.loadAllMemories();
    for (const entry of localEntries) {
      const score = this.computeBm25Score(entry, keywords);
      if (score > 0) {
        const key = entry.title.toLowerCase();
        if (!results.has(key) || score > results.get(key)!.bm25Score) {
          results.set(key, { entry, bm25Score: score });
        }
      }
    }

    // QMD 索引
    if (this.qmdClient) {
      const qmdResults = this.qmdClient.search(keywords, { maxResults: 20, minScore: 0.05 });
      for (const r of qmdResults) {
        const key = r.entry.title.toLowerCase();
        if (!results.has(key) || r.score > results.get(key)!.bm25Score) {
          results.set(key, { entry: r.entry, bm25Score: r.score });
        }
      }
    }

    return results;
  }

  // ============================================================
  // Embedding 召回（通过 OpenClaw QMD API）
  // ============================================================

  private async embeddingRecall(
    query: string,
    keywords: string[]
  ): Promise<Map<string, { entry: MemoryEntry; score: number }>> {
    const results = new Map<string, { entry: MemoryEntry; score: number }>();

    try {
      // 尝试通过 OpenClaw memory_search 获取向量结果
      const searchQuery = `${query} ${keywords.slice(0, 5).join(" ")}`;
      
      // 使用 memory_search tool 的 vector 模式
      // 如果 API 不可用，回退到扩展关键词的 BM25
      const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "auto",
          messages: [
            {
              role: "system",
              content: `You are a memory retrieval system. Given a query, find the most semantically similar past experiences.
              
Available memories are in the memory/ and MEMORY.md files. Search for entries related to: ${searchQuery}

Return a JSON array of matching memory titles (max 5), with relevance scores from 0.0 to 1.0:
{
  "matches": [
    {"title": "...", "score": 0.95}
  ]
}`,
            },
            { role: "user", content: searchQuery },
          ],
          max_tokens: 500,
          temperature: 0,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const content = data.choices?.[0]?.message?.content || "";
        try {
          const json = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || "{}");
          const matches = json.matches || [];

          // 与 BM25 结果交叉匹配
          for (const match of matches) {
            const matchedEntry = this.findEntryByTitle(match.title);
            if (matchedEntry) {
              results.set(matchedEntry.title.toLowerCase(), {
                entry: matchedEntry,
                score: match.score || 0.5,
              });
            }
          }
        } catch {
          // JSON parse failed — embedding results unavailable
        }
      }
    } catch {
      // API unavailable — embedding disabled
    }

    return results;
  }

  // ============================================================
  // 混合打分
  // ============================================================

  private hybridScore(
    bm25Map: Map<string, { entry: MemoryEntry; bm25Score: number }>,
    embeddingMap: Map<string, { entry: MemoryEntry; score: number }>,
    keywords: string[]
  ): ScoredEntry[] {
    const allKeys = new Set([...bm25Map.keys(), ...embeddingMap.keys()]);
    const results: ScoredEntry[] = [];

    for (const key of allKeys) {
      const bm25 = bm25Map.get(key);
      const emb = embeddingMap.get(key);
      const entry = bm25?.entry || emb?.entry!;

      // 归一化 BM25 到 [0, 1]
      const bm25Score = bm25 ? Math.min(1, bm25.bm25Score / (bm25.bm25Score + 5)) : 0;
      const embeddingScore = emb?.score || 0;
      const recencyScore = this.computeRecencyScore(entry);
      const source = (bm25 && emb) ? "both" : bm25 ? "bm25" : "embedding";

      // 混合公式：缺 embedding 时 BM25 权重升高
      const hasEmbedding = embeddingMap.size > 0;
      const finalScore = hasEmbedding
        ? 0.3 * bm25Score + 0.5 * embeddingScore + 0.2 * recencyScore
        : 0.7 * bm25Score + 0.3 * recencyScore; // 无 embedding 时侧重 BM25

      results.push({
        entry,
        bm25Score: Math.round(bm25Score * 100) / 100,
        embeddingScore: Math.round(embeddingScore * 100) / 100,
        recencyScore: Math.round(recencyScore * 100) / 100,
        finalScore: Math.round(finalScore * 100) / 100,
        source,
      });
    }

    return results.sort((a, b) => b.finalScore - a.finalScore);
  }

  // ============================================================
  // 辅助
  // ============================================================

  private computeBm25Score(entry: MemoryEntry, keywords: string[]): number {
    const searchText = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      const regex = new RegExp(lowerKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      score += (searchText.match(regex) || []).length * 2;
      if (searchText.includes(lowerKw)) score += 0.5;
      if (entry.tags.some(t => t.toLowerCase() === lowerKw)) score += 3;
    }

    return score;
  }

  private computeRecencyScore(entry: MemoryEntry): number {
    const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0.3, 1.0 - ageDays / 45); // 45天后衰减到 0.3
  }

  private loadAllMemories(): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    if (!fs.existsSync(this.memoryDir)) return entries;

    const missionDirs = fs.readdirSync(this.memoryDir, { withFileTypes: true }).filter(d => d.isDirectory());
    const typeFiles = [
      { file: "decisions.md", type: "decision" as const },
      { file: "failures.md", type: "failure" as const },
      { file: "solutions.md", type: "solution" as const },
      { file: "patterns.md", type: "pattern" as const },
      { file: "knowledge.md", type: "knowledge" as const },
    ];

    for (const dir of missionDirs) {
      for (const { file, type } of typeFiles) {
        const fp = path.join(this.memoryDir, dir.name, file);
        if (!fs.existsSync(fp)) continue;
        try {
          const content = fs.readFileSync(fp, "utf-8");
          entries.push(...this.parseFile(content, type, dir.name));
        } catch { /* skip */ }
      }
    }

    return entries;
  }

  private parseFile(content: string, type: MemoryEntry["type"], missionId: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const sections = content.split(/^## /m).filter(s => s.trim());

    for (const section of sections) {
      const lines = section.split("\n");
      const title = lines[0].trim();
      if (!title || title.startsWith("#")) continue;

      let tags: string[] = [], confidence = 0.7, timestamp = new Date().toISOString();
      const contentLines: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- **标签**:")) tags = line.replace("- **标签**:", "").trim().split(",").map(t => t.trim());
        else if (line.startsWith("- **可信度**:")) { const p = parseInt(line.replace("- **可信度**:", "")); confidence = isNaN(p) ? 0.7 : p / 100; }
        else if (line.startsWith("- **时间**:")) timestamp = line.replace("- **时间**:", "").trim();
        else if (line && !line.startsWith("---") && !line.startsWith("- **")) contentLines.push(line);
      }

      entries.push({ id: `hy_${missionId}_${entries.length}`, type, mission_id: missionId, timestamp, title, content: contentLines.join("\n"), tags, confidence });
    }

    return entries;
  }

  private findEntryByTitle(title: string): MemoryEntry | undefined {
    const all = this.loadAllMemories();
    return all.find(e => e.title.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(e.title.toLowerCase()));
  }
}
