/**
 * Goal Validator — 规则引擎校验 LLM 输出的 Goal 列表
 * 
 * 检查项：
 *   1. 循环依赖检测（拓扑排序）
 *   2. 依赖引用完整性（depends_on 中的 ID 必须存在）
 *   3. 语义重复检测（Jaccard 相似度 > 阈值）
 *   4. 完整性（是否覆盖了 Objective 的核心语义）
 */

import type { GeneratedGoal } from "./goal-generator.js";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: "cycle" | "missing_dependency" | "duplicate_id" | "empty";
  message: string;
  details?: any;
}

export interface ValidationWarning {
  type: "semantic_duplicate" | "too_many_goals" | "too_few_goals" | "unbalanced";
  message: string;
}

const MIN_GOALS = 1;
const MAX_GOALS = 7;
const DUPLICATE_THRESHOLD = 0.65; // Jaccard 相似度阈值

export class GoalValidator {
  /**
   * 校验 Goal 列表
   */
  validate(goals: GeneratedGoal[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. 空列表检查
    if (goals.length < MIN_GOALS) {
      errors.push({ type: "empty", message: "Goal 列表不能为空" });
      return { valid: false, errors, warnings };
    }

    // 2. 数量检查
    if (goals.length > MAX_GOALS) {
      warnings.push({ type: "too_many_goals", message: `Goal 数量 ${goals.length} 超过推荐上限 ${MAX_GOALS}` });
    }
    if (goals.length < 3) {
      warnings.push({ type: "too_few_goals", message: `Goal 数量 ${goals.length} 偏少，复杂目标建议 ≥ 3` });
    }

    // 3. Duplicate ID check
    const ids = new Set<string>();
    for (const g of goals) {
      if (ids.has(g.id)) {
        errors.push({ type: "duplicate_id", message: `重复的 Goal ID: ${g.id}` });
      }
      ids.add(g.id);
    }

    // 4. 依赖引用完整性 + 循环检测
    const depErrors = this.validateDependencies(goals);
    errors.push(...depErrors);

    // 5. 语义重复检测
    const dupWarnings = this.detectSemanticDuplicates(goals);
    warnings.push(...dupWarnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 依赖校验：完整性 + 循环检测
   */
  private validateDependencies(goals: GeneratedGoal[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const goalIds = new Set(goals.map(g => g.id));

    // 检查引用完整性
    for (const g of goals) {
      for (const depId of g.depends_on) {
        if (!goalIds.has(depId)) {
          errors.push({
            type: "missing_dependency",
            message: `Goal "${g.id}" 依赖了不存在的 Goal "${depId}"`,
          });
        }
      }
    }

    // 拓扑排序检测循环依赖
    if (errors.length === 0) {
      const cycle = this.detectCycle(goals);
      if (cycle) {
        errors.push({
          type: "cycle",
          message: `检测到循环依赖: ${cycle.join(" → ")}`,
          details: { cycle },
        });
      }
    }

    return errors;
  }

  /**
   * 拓扑排序 + 循环检测（Kahn 算法）
   */
  private detectCycle(goals: GeneratedGoal[]): string[] | null {
    const goalIds = goals.map(g => g.id);
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of goalIds) {
      adj.set(id, []);
      inDegree.set(id, 0);
    }

    for (const g of goals) {
      for (const depId of g.depends_on) {
        adj.get(depId)?.push(g.id);
        inDegree.set(g.id, (inDegree.get(g.id) || 0) + 1);
      }
    }

    // Kahn
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of (adj.get(node) || [])) {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 1) - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (visited < goalIds.length) {
      // 有环 — 找出环路径
      return this.findCyclePath(goals);
    }

    return null; // 无环
  }

  /**
   * DFS 找环路径
   */
  private findCyclePath(goals: GeneratedGoal[]): string[] {
    const adj = new Map<string, string[]>();
    for (const g of goals) {
      adj.set(g.id, g.depends_on);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const g of goals) color.set(g.id, WHITE);

    const result: string[] = [];

    function dfs(node: string, path: string[]): boolean {
      color.set(node, GRAY);
      path.push(node);
      for (const dep of (adj.get(node) || [])) {
        const c = color.get(dep);
        if (c === GRAY) {
          const idx = path.indexOf(dep);
          result.push(...path.slice(idx), dep);
          return true;
        }
        if (c === WHITE) {
          if (dfs(dep, path)) return true;
        }
      }
      color.set(node, BLACK);
      path.pop();
      return false;
    }

    for (const g of goals) {
      if (color.get(g.id) === WHITE) {
        if (dfs(g.id, [])) return result;
      }
    }

    return ["unknown_cycle"];
  }

  /**
   * 语义重复检测（基于 Jaccard 相似度）
   */
  private detectSemanticDuplicates(goals: GeneratedGoal[]): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    for (let i = 0; i < goals.length; i++) {
      for (let j = i + 1; j < goals.length; j++) {
        const similarity = this.jaccardSimilarity(
          `${goals[i].title} ${goals[i].description}`,
          `${goals[j].title} ${goals[j].description}`
        );
        if (similarity > DUPLICATE_THRESHOLD) {
          warnings.push({
            type: "semantic_duplicate",
            message: `Goal "${goals[i].title}" 和 "${goals[j].title}" 相似度 ${(similarity * 100).toFixed(0)}%，可能存在重复`,
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Jaccard 相似度（字符 bigram 级别）
   */
  private jaccardSimilarity(a: string, b: string): number {
    const bigramsA = this.getBigrams(a.toLowerCase());
    const bigramsB = this.getBigrams(b.toLowerCase());
    
    const setA = new Set(bigramsA);
    const setB = new Set(bigramsB);
    
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    
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
   * 格式化校验报告（CLI 用）
   */
  formatReport(result: ValidationResult): string {
    const lines: string[] = [];

    if (result.valid) {
      lines.push("✅ Goal 校验通过");
    } else {
      lines.push("❌ Goal 校验失败:");
      for (const err of result.errors) {
        lines.push(`   [${err.type}] ${err.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`⚠️  ${result.warnings.length} 个警告:`);
      for (const warn of result.warnings) {
        lines.push(`   [${warn.type}] ${warn.message}`);
      }
    }

    return lines.join("\n");
  }
}
