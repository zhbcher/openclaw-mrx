/**
 * QMD Lite Client — BM25 关键词检索接口
 * 
 * Walking Skeleton 阶段：直接读取 QMD 索引路径下的文件。
 * 未来升级 QMD Adapter Full：通过 memory_search tool 调用。
 * 
 * QMD 索引范围（OpenClaw 自动监控）：
 *   MEMORY.md
 *   memory/*.md
 *   memory/**\/*.md
 * 
 * 所以 Memory Compiler 输出到 memory/mrx/{missionId}/ 即可被 QMD BM25 索引。
 */

import * as fs from "fs";
import * as path from "path";
import type { MemoryEntry } from "./memory-compiler.js";

export interface QmdSearchResult {
  entry: MemoryEntry;
  score: number;
  source: string;  // 来源路径
}

export class QmdLiteClient {
  private qmdIndexPath: string;

  constructor(qmdIndexPath?: string) {
    // 默认路径：workspace 下的 memory/mrx/（QMD 索引范围）
    this.qmdIndexPath = qmdIndexPath || path.join(process.cwd(), "memory", "mrx");
  }

  /**
   * BM25 风格的关键词搜索
   * 
   * 直接扫描 QMD 索引路径下的所有 .md 文件，计算 BM25-influenced 评分。
   * 这是"Lite"版本——真正的 QMD Adapter 会通过 memory_search tool 做同样的事。
   */
  search(keywords: string[], options?: {
    maxResults?: number;
    minScore?: number;
    typeFilter?: MemoryEntry["type"][];
  }): QmdSearchResult[] {
    const { maxResults = 10, minScore = 0.05, typeFilter } = options || {};

    if (!fs.existsSync(this.qmdIndexPath)) {
      return [];
    }

    const allEntries = this.loadAllEntries();
    const scored = this.rank(allEntries, keywords, typeFilter);

    return scored
      .filter(r => r.score >= minScore)
      .slice(0, maxResults);
  }

  /**
   * 加载 QMD 索引路径下的所有 MemoryEntry
   */
  private loadAllEntries(): Array<{ entry: MemoryEntry; source: string }> {
    const results: Array<{ entry: MemoryEntry; source: string }> = [];

    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const e of entries) {
        const fullPath = path.join(dir, e.name);
        if (e.isDirectory()) {
          walkDir(fullPath);
        } else if (e.name.endsWith(".md") && e.name !== "INDEX.md") {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const parsed = this.parseMarkdownToEntries(content, e.name.replace(".md", ""), fullPath);
            for (const entry of parsed) {
              results.push({ entry, source: fullPath });
            }
          } catch {
            // 跳过无法解析的文件
          }
        }
      }
    };

    walkDir(this.qmdIndexPath);
    return results;
  }

  /**
   * 解析 Markdown 为 MemoryEntry 列表
   */
  private parseMarkdownToEntries(content: string, type: string, sourcePath: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    
    // 从路径推断 mission_id
    const missionId = sourcePath.split(path.sep).slice(-2, -1)[0] || "unknown";

    // 按 ## 标题分割
    const sections = content.split(/^## /m).filter(s => s.trim());
    const typeName = this.normalizeType(type);

    for (const section of sections) {
      const lines = section.split("\n");
      const title = lines[0].trim();
      if (!title || title.startsWith("#")) continue;

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
        } else if (line && !line.startsWith("---") && !line.startsWith("- **") && !line.startsWith("> ")) {
          contentLines.push(line);
        }
      }

      entries.push({
        id: `qmd_${missionId}_${typeName}_${entries.length}`,
        type: typeName,
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

  private normalizeType(type: string): MemoryEntry["type"] {
    const map: Record<string, MemoryEntry["type"]> = {
      "decisions": "decision",
      "failures": "failure",
      "solutions": "solution",
      "patterns": "pattern",
      "knowledge": "knowledge",
    };
    return map[type] || "knowledge";
  }

  /**
   * BM25-influenced 评分
   */
  private rank(
    entries: Array<{ entry: MemoryEntry; source: string }>,
    keywords: string[],
    typeFilter?: MemoryEntry["type"][]
  ): QmdSearchResult[] {
    return entries
      .filter(e => !typeFilter || typeFilter.includes(e.entry.type))
      .map(({ entry, source }) => {
        const searchText = `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
        
        let score = 0;
        for (const kw of keywords) {
          const lowerKw = kw.toLowerCase();
          
          // 精确词匹配（加权最高）
          const wordRegex = new RegExp(`\\b${this.escapeRegex(lowerKw)}\\b`, "gi");
          const wordMatches = (searchText.match(wordRegex) || []).length;
          score += wordMatches * 3;

          // 子串匹配
          if (searchText.includes(lowerKw)) {
            score += 1;
          }

          // 标签精确匹配
          if (entry.tags.some(t => t.toLowerCase() === lowerKw)) {
            score += 4;
          }
        }

        // 标题命中加权
        const titleLower = entry.title.toLowerCase();
        for (const kw of keywords) {
          if (titleLower.includes(kw.toLowerCase())) {
            score += 2;
          }
        }

        // 类型权重
        const typeWeight = {
          failure: 1.5, solution: 1.3, pattern: 1.1, decision: 1.0, knowledge: 0.8,
        }[entry.type] || 1.0;

        // 新鲜度
        const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        const freshness = Math.max(0.3, 1.0 - ageDays / 45);

        const raw = score * typeWeight * freshness * entry.confidence;
        return { entry, score: Math.round(raw / (raw + 8) * 100) / 100, source };
      })
      .sort((a, b) => b.score - a.score);
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 获取索引统计
   */
  getStats(): { totalFiles: number; totalEntries: number; byType: Record<string, number>; lastIndexed: string } {
    if (!fs.existsSync(this.qmdIndexPath)) {
      return { totalFiles: 0, totalEntries: 0, byType: {}, lastIndexed: "never" };
    }

    let totalFiles = 0;
    const byType: Record<string, number> = {};

    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          walk(path.join(dir, e.name));
        } else if (e.name.endsWith(".md") && e.name !== "INDEX.md") {
          totalFiles++;
          // 从文件名推断类型
          const type = e.name.replace(".md", "");
          byType[type] = (byType[type] || 0) + 1;
        }
      }
    };
    walk(this.qmdIndexPath);

    // 找出最近修改的文件
    let lastModified = 0;
    const walkTime = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walkTime(fp);
        else {
          const stat = fs.statSync(fp);
          if (stat.mtimeMs > lastModified) lastModified = stat.mtimeMs;
        }
      }
    };
    walkTime(this.qmdIndexPath);

    return {
      totalFiles,
      totalEntries: totalFiles * 3, // 估算：每个文件约 3 个条目
      byType,
      lastIndexed: lastModified > 0 ? new Date(lastModified).toISOString() : "never",
    };
  }
}
