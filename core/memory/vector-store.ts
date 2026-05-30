/**
 * Vector Store — 内置向量存储与语义检索
 * 
 * 不依赖外部向量服务（Pinecone/Qdrant Cloud）。
 * 使用 SQLite 存储 embedding，本地计算 Cosine Similarity。
 * 
 * 用于：
 *   - Memory Recall（语义相似检索）
 *   - Goal Validator（重复检测）
 *   - Failure Pattern Matching
 */

import { getDatabase } from "../state-graph/database.js";

export interface VectorEntry {
  id: string;
  content: string;        // 原始文本
  embedding: number[];    // 向量
  category: string;       // "memory" | "goal" | "failure" | "pattern"
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface SimilarityResult {
  entry: VectorEntry;
  score: number;
}

export class VectorStore {
  private db = getDatabase();

  constructor() {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'memory',
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_category ON memory_vectors(category);
    `);
  }

  /**
   * 写入向量
   */
  insert(entry: VectorEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (id, content, embedding, category, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.content,
      JSON.stringify(entry.embedding),
      entry.category,
      JSON.stringify(entry.metadata || {}),
      entry.created_at
    );
  }

  /**
   * 批量写入
   */
  insertBatch(entries: VectorEntry[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (id, content, embedding, category, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const e of entries) {
        insert.run(e.id, e.content, JSON.stringify(e.embedding), e.category, JSON.stringify(e.metadata || {}), e.created_at);
      }
    })();
  }

  /**
   * Cosine Similarity 搜索
   */
  search(queryEmbedding: number[], category?: string, topK: number = 10, minScore: number = 0.3): SimilarityResult[] {
    let sql = "SELECT * FROM memory_vectors";
    const params: any[] = [];

    if (category) {
      sql += " WHERE category = ?";
      params.push(category);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const results: SimilarityResult[] = [];

    for (const row of rows) {
      const embedding: number[] = JSON.parse(row.embedding);
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      if (score >= minScore) {
        results.push({
          entry: {
            id: row.id,
            content: row.content,
            embedding,
            category: row.category,
            created_at: row.created_at,
            metadata: JSON.parse(row.metadata || "{}"),
          },
          score,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * 获取所有向量（用于批量比较）
   */
  getAll(category?: string): VectorEntry[] {
    let sql = "SELECT * FROM memory_vectors";
    const params: any[] = [];
    if (category) { sql += " WHERE category = ?"; params.push(category); }

    return (this.db.prepare(sql).all(...params) as any[]).map(row => ({
      id: row.id,
      content: row.content,
      embedding: JSON.parse(row.embedding),
      category: row.category,
      created_at: row.created_at,
      metadata: JSON.parse(row.metadata || "{}"),
    }));
  }

  /**
   * Cosine Similarity
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const mag = Math.sqrt(na) * Math.sqrt(nb);
    return mag === 0 ? 0 : dot / mag;
  }

  /**
   * 统计
   */
  getStats(): { total: number; byCategory: Record<string, number> } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM memory_vectors").get() as any).c;
    const cats = this.db.prepare("SELECT category, COUNT(*) as c FROM memory_vectors GROUP BY category").all() as any[];
    const byCategory: Record<string, number> = {};
    for (const c of cats) byCategory[c.category] = c.c;
    return { total, byCategory };
  }

  /**
   * 清除过期向量（保留最近 N 条）
   */
  prune(maxPerCategory: number = 1000): number {
    const result = this.db.prepare(`
      DELETE FROM memory_vectors WHERE id IN (
        SELECT id FROM memory_vectors WHERE category = ?
        ORDER BY created_at ASC LIMIT max(0, (SELECT COUNT(*) FROM memory_vectors WHERE category = ?) - ?)
      )
    `);
    let deleted = 0;
    const cats = this.db.prepare("SELECT DISTINCT category FROM memory_vectors").all() as any[];
    for (const { category } of cats) {
      const r = result.run(category, category, maxPerCategory);
      deleted += r.changes;
    }
    return deleted;
  }
}
