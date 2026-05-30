/**
 * Failure Learning Memory — 失败模式库
 * 
 * 记录每次失败的根因和解决方案，形成可检索的模式库。
 * Recovery Engine 在决策前查询此库，避免重复错误。
 * 
 * 结构：
 *   失败 → 根因分类 → 解决方案 → 下次自动应用
 */

import { getDatabase } from "../state-graph/database.js";

export interface FailurePattern {
  id: string;
  /** 错误类型：network | build | test | type | permission | timeout | unknown */
  errorType: string;
  /** 错误关键词（用于匹配） */
  keywords: string[];
  /** 根因分析 */
  rootCause: string;
  /** 解决方案 */
  solution: string;
  /** 发生次数 */
  occurrenceCount: number;
  /** 成功率（应用此方案后成功的比例） */
  successRate: number;
  /** 最近一次发生时间 */
  lastSeenAt: string;
  created_at: string;
}

export class FailureMemory {
  private db = getDatabase();

  constructor() {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS failure_patterns (
        id TEXT PRIMARY KEY,
        error_type TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '[]',
        root_cause TEXT NOT NULL,
        solution TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        success_rate REAL NOT NULL DEFAULT 0.5,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_failure_type ON failure_patterns(error_type);
      CREATE INDEX IF NOT EXISTS idx_failure_success ON failure_patterns(success_rate);
    `);
  }

  /**
   * 记录一次失败
   */
  record(input: {
    errorMessage: string;
    rootCause: string;
    solution?: string;
    wasSuccessful?: boolean;  // 方案是否有效
  }): FailurePattern {
    const errorType = this.classifyError(input.errorMessage);
    const keywords = this.extractKeywords(input.errorMessage);
    const now = new Date().toISOString();
    const id = `fail_${errorType}_${Date.now()}`;

    // 检查是否已有相似模式
    const existing = this.findSimilar(errorType, keywords);
    
    if (existing && existing.solution === (input.solution || "")) {
      // 更新现有模式
      const newCount = existing.occurrenceCount + 1;
      const newRate = input.wasSuccessful !== undefined
        ? ((existing.successRate * existing.occurrenceCount) + (input.wasSuccessful ? 1 : 0)) / newCount
        : existing.successRate;

      this.db.prepare(`
        UPDATE failure_patterns SET occurrence_count=?, success_rate=?, last_seen_at=?, keywords=?
        WHERE id=?
      `).run(newCount, newRate, now, JSON.stringify(keywords), existing.id);

      return { ...existing, occurrenceCount: newCount, successRate: newRate, lastSeenAt: now };
    }

    // 新建模式
    const pattern: FailurePattern = {
      id,
      errorType,
      keywords,
      rootCause: input.rootCause,
      solution: input.solution || "unknown",
      occurrenceCount: 1,
      successRate: input.wasSuccessful ? 1.0 : 0.3,
      lastSeenAt: now,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO failure_patterns (id, error_type, keywords, root_cause, solution, occurrence_count, success_rate, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pattern.id, pattern.errorType, JSON.stringify(pattern.keywords), pattern.rootCause, pattern.solution, pattern.occurrenceCount, pattern.successRate, pattern.lastSeenAt, pattern.created_at);

    return pattern;
  }

  /**
   * 根据错误信息查找匹配的失败模式
   */
  findSolutions(errorMessage: string, maxResults: number = 3): FailurePattern[] {
    const errorType = this.classifyError(errorMessage);
    const keywords = this.extractKeywords(errorMessage);

    // 先按类型查
    let patterns = this.db.prepare(
      "SELECT * FROM failure_patterns WHERE error_type = ? ORDER BY success_rate DESC, occurrence_count DESC LIMIT ?"
    ).all(errorType, maxResults) as any[];

    // 如果类型匹配不够，按关键词查
    if (patterns.length < maxResults) {
      patterns = this.db.prepare(
        "SELECT * FROM failure_patterns ORDER BY success_rate DESC, occurrence_count DESC LIMIT ?"
      ).all(maxResults) as any[];
    }

    return patterns.map(p => ({
      id: p.id,
      errorType: p.error_type,
      keywords: JSON.parse(p.keywords),
      rootCause: p.root_cause,
      solution: p.solution,
      occurrenceCount: p.occurrence_count,
      successRate: p.success_rate,
      lastSeenAt: p.last_seen_at,
      created_at: p.created_at,
    }));
  }

  /**
   * 获取高频失败模式（用于报告和预警）
   */
  getTopFailures(limit: number = 10): FailurePattern[] {
    return (this.db.prepare(
      "SELECT * FROM failure_patterns WHERE success_rate < 0.5 ORDER BY occurrence_count DESC LIMIT ?"
    ).all(limit) as any[]).map(p => ({
      id: p.id, errorType: p.error_type, keywords: JSON.parse(p.keywords),
      rootCause: p.root_cause, solution: p.solution,
      occurrenceCount: p.occurrence_count, successRate: p.success_rate,
      lastSeenAt: p.last_seen_at, created_at: p.created_at,
    }));
  }

  /**
   * 更新方案的成败结果（学习反馈）
   */
  feedback(patternId: string, wasSuccessful: boolean): void {
    const pattern = this.db.prepare("SELECT * FROM failure_patterns WHERE id = ?").get(patternId) as any;
    if (!pattern) return;

    const newCount = pattern.occurrence_count;
    const newRate = ((pattern.success_rate * newCount) + (wasSuccessful ? 1 : 0)) / (newCount + 1);

    this.db.prepare(
      "UPDATE failure_patterns SET success_rate = ?, occurrence_count = occurrence_count + 1, last_seen_at = ? WHERE id = ?"
    ).run(newRate, new Date().toISOString(), patternId);
  }

  // ============================================================
  // Private
  // ============================================================

  private classifyError(errorMessage: string): string {
    const lower = errorMessage.toLowerCase();
    if (lower.includes("network") || lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("enotfound")) return "network";
    if (lower.includes("build") || lower.includes("compil") || lower.includes("tsc") || lower.includes("cannot find module")) return "build";
    if (lower.includes("test") || lower.includes("assert") || lower.includes("expect")) return "test";
    if (lower.includes("type") || lower.includes("is not assignable") || lower.includes("property") && lower.includes("does not exist")) return "type";
    if (lower.includes("permission") || lower.includes("eacces") || lower.includes("denied")) return "permission";
    if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
    return "unknown";
  }

  private extractKeywords(errorMessage: string): string[] {
    return errorMessage
      .split(/[\s:;,]+/)
      .filter(w => w.length > 2 && !["the", "and", "for", "was", "not", "but"].includes(w.toLowerCase()))
      .slice(0, 8);
  }

  private findSimilar(errorType: string, keywords: string[]): FailurePattern | null {
    const patterns = this.db.prepare(
      "SELECT * FROM failure_patterns WHERE error_type = ?"
    ).all(errorType) as any[];

    if (patterns.length === 0) return null;

    // 找关键词重叠最多的模式
    let bestMatch: any = null;
    let bestScore = 0;

    for (const p of patterns) {
      const existingKeywords: string[] = JSON.parse(p.keywords);
      const overlap = keywords.filter(k => existingKeywords.includes(k)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestMatch = p;
      }
    }

    return bestMatch && bestScore >= 2 ? {
      id: bestMatch.id,
      errorType: bestMatch.error_type,
      keywords: JSON.parse(bestMatch.keywords),
      rootCause: bestMatch.root_cause,
      solution: bestMatch.solution,
      occurrenceCount: bestMatch.occurrence_count,
      successRate: bestMatch.success_rate,
      lastSeenAt: bestMatch.last_seen_at,
      created_at: bestMatch.created_at,
    } : null;
  }
}
