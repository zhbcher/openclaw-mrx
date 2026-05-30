/**
 * Hierarchical Planner — Hybrid Planner 门面
 * 
 * 编排流程：
 *   Objective
 *     ↓ (GoalGenerator — LLM)
 *   Goal[]
 *     ↓ (GoalValidator — 规则)
 *   Validated Goals
 *     ↓ (DAG Builder — 规则)
 *   Task DAG（此 Skeleton 中不展开，留白给后续 Phase）
 * 
 * Walking Skeleton 只走到 Goal 层 + 校验。
 */

import { GoalGenerator, type PlannerOutput, type GeneratedGoal } from "./goal-generator.js";
import { GoalValidator } from "./goal-validator.js";
import { ObjectiveEngine } from "../objective/objective-engine.js";
import type { LlmClient } from "./dag-planner.js";

export interface PlanResult {
  objectiveId: string;
  objectiveTitle: string;
  objectiveSummary: string;
  goals: GeneratedGoal[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  metadata?: {
    model?: string;
    durationMs?: number;
  };
}

export class HierarchicalPlanner {
  private goalGenerator: GoalGenerator;
  private goalValidator: GoalValidator;
  private objectiveEngine: ObjectiveEngine;

  constructor(llmClient: LlmClient) {
    this.goalGenerator = new GoalGenerator(llmClient);
    this.goalValidator = new GoalValidator();
    this.objectiveEngine = new ObjectiveEngine();
  }

  /**
   * 完整规划流程：创建 Objective → LLM 拆 Goal → 校验 → 持久化
   */
  async plan(input: {
    title: string;
    description?: string;
    constraints?: string[];
    workingDir?: string;
  }): Promise<PlanResult> {
    const startedAt = Date.now();

    // Step 1: 创建 Objective
    console.log(`\n🎯 创建 Objective: ${input.title}`);
    const objective = this.objectiveEngine.create({
      title: input.title,
      description: input.description,
      workingDir: input.workingDir,
      constraints: input.constraints,
    });
    console.log(`   ID: ${objective.id} | Status: ${objective.status}`);

    // Step 2: LLM 拆解 Goal
    console.log(`\n🧠 LLM 拆解 Goal...`);
    let plannerOutput: PlannerOutput;
    try {
      plannerOutput = await this.goalGenerator.generate(
        input.title,
        input.description || "",
        input.constraints
      );
    } catch (err) {
      console.log(`   ❌ LLM 拆解失败: ${(err as Error).message}`);
      return {
        objectiveId: objective.id,
        objectiveTitle: input.title,
        objectiveSummary: "",
        goals: [],
        validation: { valid: false, errors: [(err as Error).message], warnings: [] },
      };
    }
    console.log(`   生成了 ${plannerOutput.goals.length} 个 Goal`);

    // Step 3: 校验
    console.log(`\n🔍 Goal Validator 校验...`);
    const validation = this.goalValidator.validate(plannerOutput.goals);
    console.log(`   ${this.goalValidator.formatReport(validation)}`);

    if (!validation.valid) {
      return {
        objectiveId: objective.id,
        objectiveTitle: input.title,
        objectiveSummary: plannerOutput.objective_summary,
        goals: plannerOutput.goals,
        validation: {
          valid: false,
          errors: validation.errors.map(e => `[${e.type}] ${e.message}`),
          warnings: validation.warnings.map(w => `[${w.type}] ${w.message}`),
        },
      };
    }

    // Step 4: 持久化 Goals
    console.log(`\n💾 持久化到 State Graph (SQLite)...`);
    const goalsWithIds = plannerOutput.goals.map(g => ({
      ...g,
      id: g.id,
      objective_id: objective.id,
    }));

    this.objectiveEngine.attachGoals(
      objective.id,
      goalsWithIds.map(g => ({
        id: g.id,
        title: g.title,
        description: g.description,
        deliverable: g.deliverable,
        complexity: g.estimated_complexity,
        depends_on: g.depends_on,
      }))
    );

    // 标记规划完成
    this.objectiveEngine.confirmPlanning(objective.id);
    this.objectiveEngine.start(objective.id);

    console.log(`   ✅ ${plannerOutput.goals.length} 个 Goal 已写入数据库`);

    return {
      objectiveId: objective.id,
      objectiveTitle: input.title,
      objectiveSummary: plannerOutput.objective_summary,
      goals: plannerOutput.goals,
      validation: {
        valid: true,
        errors: [],
        warnings: validation.warnings.map(w => `[${w.type}] ${w.message}`),
      },
      metadata: {
        durationMs: Date.now() - startedAt,
      },
    };
  }

  /**
   * 查询规划结果（从 State Graph 恢复）
   */
  getPlan(objectiveId: string) {
    return this.objectiveEngine.getFull(objectiveId);
  }
}
