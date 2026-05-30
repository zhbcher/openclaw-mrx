/**
 * Goal Generator — LLM 驱动 Objective → Goal[] 分解
 * 
 * 使用 Architecture Freeze 定义的 Planner Output Contract（JSON Schema）
 * 作为 LLM 输出约束。输出由 Goal Validator 校验后生效。
 */

import type { LlmClient } from "../planner/dag-planner.js";

export interface GeneratedGoal {
  id: string;
  title: string;
  description: string;
  deliverable: string;
  depends_on: string[];
  estimated_complexity: "low" | "medium" | "high";
  suggested_tasks?: Array<{
    description: string;
    depends_on_index?: number[];
  }>;
}

export interface PlannerOutput {
  version: number;
  objective_id: string;
  objective_summary: string;
  goals: GeneratedGoal[];
  metadata?: {
    model?: string;
    generation_duration_ms?: number;
    confidence?: number;
  };
}

const SYSTEM_PROMPT = `你是软件架构师。给定工程目标，拆解为 3-7 个子目标。

每个子目标必须：
1. 独立可验证（有明确的交付物）
2. 标注与其他子目标的依赖关系
3. 尽量解耦（无依赖的子目标可以并行执行）

输出必须是严格的 JSON 格式，符合以下 Schema：
{
  "version": 1,
  "objective_id": "obj_xxxxxxxxx",
  "objective_summary": "一句话摘要",
  "goals": [
    {
      "id": "goal_01",
      "title": "子目标标题",
      "description": "详细描述",
      "deliverable": "可独立验证的交付物",
      "depends_on": [],
      "estimated_complexity": "medium"
    }
  ]
}

约束：
1. 最多 7 个 Goal，至少 1 个
2. 每个 Goal 的 description 不超过 200 字
3. depends_on 只能引用 goals 数组中已出现的 id
4. 不得出现循环依赖
5. estimated_complexity 只能是 "low" / "medium" / "high"
6. deliverable 不超过 120 字，能说清验收标准`;

export class GoalGenerator {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  async generate(objectiveTitle: string, objectiveDescription: string, constraints?: string[]): Promise<PlannerOutput> {
    const startedAt = Date.now();
    const objectiveId = "obj_pending"; // 由调用方替换

    const prompt = `请将以下工程目标拆解为子目标：

**目标标题**：${objectiveTitle}
**目标描述**：${objectiveDescription || "无"}
**约束条件**：${constraints?.join("; ") || "无"}

输出 JSON（只输出 JSON，不要输出其他内容）：`;

    const response = await this.llm.chat(prompt, SYSTEM_PROMPT);
    const parsed = this.extractAndValidate(response);
    
    return {
      ...parsed,
      objective_id: objectiveId,
      metadata: {
        generation_duration_ms: Date.now() - startedAt,
        confidence: 0.8,
      },
    };
  }

  private extractAndValidate(response: string): Omit<PlannerOutput, "objective_id" | "metadata"> {
    // 尝试提取 JSON
    let jsonStr = response;
    
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) || 
                      response.match(/```\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      
      // 基础校验
      if (!parsed.goals || !Array.isArray(parsed.goals)) {
        throw new Error("Missing 'goals' array in LLM output");
      }
      if (parsed.goals.length === 0) {
        throw new Error("Empty goals array");
      }
      if (parsed.goals.length > 7) {
        console.log(`  ⚠️  LLM 生成了 ${parsed.goals.length} 个 Goal，超过推荐上限 7，保留前 7 个`);
        parsed.goals = parsed.goals.slice(0, 7);
      }

      // 校验每个 Goal
      const goalIds = new Set<string>();
      for (const g of parsed.goals) {
        if (!g.id || !g.title || !g.description || !g.deliverable) {
          throw new Error(`Goal missing required fields: ${JSON.stringify(g)}`);
        }
        if (goalIds.has(g.id)) {
          throw new Error(`Duplicate goal id: ${g.id}`);
        }
        goalIds.add(g.id);
        
        // 校验 depends_on 引用存在
        if (g.depends_on) {
          for (const depId of g.depends_on) {
            if (!goalIds.has(depId)) {
              throw new Error(`Goal ${g.id} depends on ${depId} which doesn't exist or appears after it`);
            }
          }
        }

        // 校验 complexity
        if (g.estimated_complexity && !["low", "medium", "high"].includes(g.estimated_complexity)) {
          g.estimated_complexity = "medium";
        }
        if (!g.estimated_complexity) {
          g.estimated_complexity = "medium";
        }
        
        // 确保 depends_on 是数组
        if (!Array.isArray(g.depends_on)) {
          g.depends_on = [];
        }
      }

      return {
        version: 1,
        objective_summary: parsed.objective_summary || "",
        goals: parsed.goals,
      };
    } catch (err) {
      throw new Error(`Failed to parse LLM output as JSON: ${(err as Error).message}\n\nRaw response:\n${response.slice(0, 500)}`);
    }
  }
}
