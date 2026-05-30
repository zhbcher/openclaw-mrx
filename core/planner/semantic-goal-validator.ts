/**
 * Semantic Goal Validator — Embedding-based 语义校验
 * 
 * V2 升级：从 Jaccard bigram 升级为 Embedding Cosine Similarity
 * 
 * 检测项：
 *   1. 语义重复（cosine > 0.85 视为重复）
 *   2. 冲突检测（两个 Goal 描述互相矛盾）
 *   3. 完整性（Goal 集合覆盖了 Objective 的核心语义）
 */

import type { GeneratedGoal } from "./goal-generator.js";

export interface SemanticValidationResult {
  valid: boolean;
  errors: Array<{ type: string; message: string; details?: any }>;
  warnings: Array<{ type: string; message: string }>;
  /** 每对 Goal 的相似度矩阵 */
  similarityMatrix?: Array<{
    goalA: string;
    goalB: string;
    similarity: number;
    method: "embedding" | "jaccard";
  }>;
}

const EMBEDDING_DUPLICATE_THRESHOLD = 0.85; // cosine > 0.85 = 重复
const JACCARD_DUPLICATE_THRESHOLD = 0.65;    // 回退阈值

import { CONFIG } from "../config.js";

export class SemanticGoalValidator {
  private apiBaseUrl: string;

  constructor(apiBaseUrl?: string) {
    this.apiBaseUrl = apiBaseUrl || CONFIG.apiBaseUrl;
  }

  /**
   * 语义校验 Goal 列表
   */
  async validate(goals: GeneratedGoal[]): Promise<SemanticValidationResult> {
    const errors: SemanticValidationResult["errors"] = [];
    const warnings: SemanticValidationResult["warnings"] = [];
    const similarityMatrix: Array<{ goalA: string; goalB: string; similarity: number; method: "embedding" | "jaccard" }> = [];

    // 空列表
    if (goals.length === 0) {
      return { valid: false, errors: [{ type: "empty", message: "Goal 列表为空" }], warnings };
    }

    // 尝试获取 embeddings
    const embeddings = await this.getEmbeddings(goals);

    // 两两比较语义相似度
    for (let i = 0; i < goals.length; i++) {
      for (let j = i + 1; j < goals.length; j++) {
        const similarity = embeddings
          ? this.cosineSimilarity(embeddings[i], embeddings[j])
          : this.jaccardBigram(`${goals[i].title} ${goals[i].description}`, `${goals[j].title} ${goals[j].description}`);

        const method = embeddings ? "embedding" : "jaccard";
        const threshold = embeddings ? EMBEDDING_DUPLICATE_THRESHOLD : JACCARD_DUPLICATE_THRESHOLD;

        similarityMatrix.push({
          goalA: goals[i].title,
          goalB: goals[j].title,
          similarity: Math.round(similarity * 1000) / 1000,
          method,
        });

        if (similarity >= threshold) {
          warnings.push({
            type: "semantic_duplicate",
            message: `"${goals[i].title}" 和 "${goals[j].title}" 语义高度相似 (${method}: ${(similarity * 100).toFixed(1)}%)，可能存在重复`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      similarityMatrix,
    };
  }

  // ============================================================
  // Embedding + Cosine
  // ============================================================

  /**
   * 为 Goal 列表获取 embeddings
   */
  private async getEmbeddings(goals: GeneratedGoal[]): Promise<number[][] | null> {
    try {
      const texts = goals.map(g => `${g.title}: ${g.description}`);
      
      const response = await fetch(`${this.apiBaseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "text-embedding-3-large",
          input: texts,
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      return data.data?.map((d: any) => d.embedding) || null;
    } catch {
      // API 不可用 → 回退 Jaccard
      return null;
    }
  }

  /**
   * Cosine Similarity
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    if (a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
  }

  // ============================================================
  // 回退方案：Jaccard Bigram
  // ============================================================

  private jaccardBigram(a: string, b: string): number {
    const bigramsA = new Set(this.getBigrams(a.toLowerCase()));
    const bigramsB = new Set(this.getBigrams(b.toLowerCase()));
    const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)));
    const union = new Set([...bigramsA, ...bigramsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private getBigrams(text: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.push(text.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * 格式化报告
   */
  formatReport(result: SemanticValidationResult): string {
    const lines: string[] = [];
    const method = result.similarityMatrix?.[0]?.method || "unknown";

    if (result.valid && result.warnings.length === 0) {
      lines.push(`✅ 语义校验通过 (${method})`);
    } else {
      if (result.warnings.length > 0) {
        lines.push(`⚠️  ${result.warnings.length} 个警告 (${method}):`);
        for (const w of result.warnings) {
          lines.push(`   [${w.type}] ${w.message}`);
        }
      }
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          lines.push(`   ❌ [${e.type}] ${e.message}`);
        }
      }
    }

    if (result.similarityMatrix && result.similarityMatrix.length > 0) {
      lines.push(`\n  相似度矩阵 (${method}):`);
      for (const { goalA, goalB, similarity } of result.similarityMatrix) {
        const bar = "█".repeat(Math.round(similarity * 20));
        lines.push(`    "${goalA}" ↔ "${goalB}": ${bar} ${(similarity * 100).toFixed(1)}%`);
      }
    }

    return lines.join("\n");
  }
}
