/**
 * DAG Planner — 目标 → 任务 DAG
 * 
 * Phase 2 核心模块。将自然语言目标拆解为带依赖关系的任务图。
 * 
 * 拆解策略：
 * 1. 关键词规则匹配（快速路径）
 * 2. LLM 深度分析（完整路径，需要 adapter 提供 LlmClient）
 * 
 * 输出：TaskNode[] 的 DAG，包含 depends_on 和 children 依赖关系
 */

import type { MissionConfig, TaskNode } from "../types.js";

// ============================================================
// 拆解策略接口
// ============================================================

export interface DecompositionStrategy {
  name: string;
  decompose(objective: string[], config: MissionConfig): Promise<TaskNode[]>;
}

// ============================================================
// 规则匹配策略（无 LLM 依赖，快速路径）
// ============================================================

const PATTERNS: Array<{
  keywords: string[];
  tasks: Array<{ description: string; dependsOn: number[] }>;
}> = [
  {
    keywords: ["迁移", "migrate", "typescript", "ts", "重构"],
    tasks: [
      { description: "分析现有代码结构，识别迁移范围", dependsOn: [] },
      { description: "配置 tsconfig.json 和构建工具链", dependsOn: [0] },
      { description: "逐模块迁移：核心类型定义", dependsOn: [1] },
      { description: "逐模块迁移：API/服务层", dependsOn: [2] },
      { description: "逐模块迁移：工具/辅助函数", dependsOn: [2] },
      { description: "运行类型检查和修复错误", dependsOn: [3, 4] },
      { description: "运行测试验证功能完整性", dependsOn: [5] },
      { description: "更新文档和 CI 配置", dependsOn: [6] },
    ],
  },
  {
    keywords: ["测试", "test", "覆盖率", "coverage"],
    tasks: [
      { description: "分析当前测试覆盖情况", dependsOn: [] },
      { description: "编写核心模块单元测试", dependsOn: [0] },
      { description: "编写集成测试", dependsOn: [0] },
      { description: "运行全量测试并修复失败用例", dependsOn: [1, 2] },
      { description: "验证覆盖率达标", dependsOn: [3] },
    ],
  },
  {
    keywords: ["安全", "security", "审计", "audit", "漏洞"],
    tasks: [
      { description: "依赖安全扫描（npm audit / pip audit）", dependsOn: [] },
      { description: "代码静态安全分析", dependsOn: [] },
      { description: "敏感信息泄露检查", dependsOn: [] },
      { description: "修复高危漏洞", dependsOn: [0, 1, 2] },
      { description: "验证修复后安全性", dependsOn: [3] },
    ],
  },
  {
    keywords: ["性能", "performance", "优化", "optimize"],
    tasks: [
      { description: "性能基准测试，记录当前指标", dependsOn: [] },
      { description: "识别性能瓶颈（热点分析）", dependsOn: [0] },
      { description: "实施优化方案", dependsOn: [1] },
      { description: "回归性能测试，对比优化效果", dependsOn: [2] },
    ],
  },
  {
    keywords: ["文档", "documentation", "doc", "readme"],
    tasks: [
      { description: "审查现有文档完整性和准确性", dependsOn: [] },
      { description: "更新/补充 API 文档", dependsOn: [0] },
      { description: "更新/补充使用指南", dependsOn: [0] },
      { description: "更新 README 和贡献指南", dependsOn: [1, 2] },
      { description: "文档一致性检查", dependsOn: [3] },
    ],
  },
];

export class RuleBasedDecomposer implements DecompositionStrategy {
  readonly name = "rule-based";

  async decompose(objective: string[], config: MissionConfig): Promise<TaskNode[]> {
    const objectiveText = objective.join(" ").toLowerCase();
    
    // 匹配关键词
    let bestMatch: typeof PATTERNS[0] | null = null;
    let bestScore = 0;

    for (const pattern of PATTERNS) {
      const score = pattern.keywords.filter(kw => objectiveText.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    if (bestMatch && bestScore > 0) {
      return this.buildDAG(bestMatch, config);
    }

    // 无匹配：生成通用三步任务
    return this.buildGenericTask(objective, config);
  }

  private buildDAG(pattern: typeof PATTERNS[0], config: MissionConfig): TaskNode[] {
    const tasks: TaskNode[] = pattern.tasks.map((t, i) => ({
      id: `task_${String(i + 1).padStart(2, "0")}`,
      description: t.description,
      depends_on: t.dependsOn.map(d => `task_${String(d + 1).padStart(2, "0")}`),
      children: [],
      status: "pending" as const,
      retry_count: 0,
      max_retries: config.budget.max_failures_per_task,
    }));

    // 反向填充 children
    for (const task of tasks) {
      for (const depId of task.depends_on) {
        const parent = tasks.find(t => t.id === depId);
        if (parent && !parent.children.includes(task.id)) {
          parent.children.push(task.id);
        }
      }
    }

    return tasks;
  }

  private buildGenericTask(objective: string[], config: MissionConfig): TaskNode[] {
    const tasks: TaskNode[] = [
      {
        id: "task_01",
        description: `理解目标：${objective[0]}`,
        depends_on: [],
        children: ["task_02"],
        status: "pending",
        retry_count: 0,
        max_retries: config.budget.max_failures_per_task,
      },
      {
        id: "task_02",
        description: "实施变更",
        depends_on: ["task_01"],
        children: ["task_03"],
        status: "pending",
        retry_count: 0,
        max_retries: config.budget.max_failures_per_task,
      },
      {
        id: "task_03",
        description: "验证结果",
        depends_on: ["task_02"],
        children: [],
        status: "pending",
        retry_count: 0,
        max_retries: config.budget.max_failures_per_task,
      },
    ];
    return tasks;
  }
}

// ============================================================
// LLM 深度拆解策略（需要 adapter 提供 LlmClient）
// ============================================================

export interface LlmClient {
  chat(prompt: string, systemPrompt?: string): Promise<string>;
}

const DAG_SYSTEM_PROMPT = `你是一个任务拆解专家。给定一个工程目标，你需要将其拆解为可执行的任务 DAG。

输出格式必须是严格的 JSON：
{
  "tasks": [
    {
      "id": "task_01",
      "description": "任务描述",
      "depends_on": [],
      "reason": "为什么需要这个任务"
    }
  ]
}

拆解原则：
1. 每个任务应该是独立可执行的单元
2. depends_on 列出前置依赖的任务 id
3. 能并行的任务不要串行（无依赖关系的任务可以并行执行）
4. 验证任务应该放在最后，依赖所有实现任务
5. 保守估计：5-10 个任务为宜，不要过度拆解`;

export class LlmDecomposer implements DecompositionStrategy {
  readonly name = "llm";
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  async decompose(objective: string[], config: MissionConfig): Promise<TaskNode[]> {
    const objectiveText = objective.join("\n");
    const prompt = `请将以下工程目标拆解为任务 DAG：

目标：
${objectiveText}

项目路径：${config.environment.working_dir}
约束条件：${config.constraints.join("; ") || "无"}`;

    try {
      const response = await this.llm.chat(prompt, DAG_SYSTEM_PROMPT);
      const json = this.extractJSON(response);
      return this.jsonToTaskNodes(json.tasks, config);
    } catch (err) {
      console.log(`  ⚠️  LLM 拆解失败，回退到规则引擎: ${(err as Error).message}`);
      const fallback = new RuleBasedDecomposer();
      return fallback.decompose(objective, config);
    }
  }

  private extractJSON(response: string): { tasks: Array<{ id: string; description: string; depends_on: string[] }> } {
    // 尝试提取 JSON 块
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) || 
                      response.match(/```\s*([\s\S]*?)```/) ||
                      [null, response];
    const jsonStr = (jsonMatch[1] || response).trim();
    return JSON.parse(jsonStr);
  }

  private jsonToTaskNodes(
    rawTasks: Array<{ id: string; description: string; depends_on: string[] }>,
    config: MissionConfig
  ): TaskNode[] {
    const tasks: TaskNode[] = rawTasks.map(t => ({
      id: t.id,
      description: t.description,
      depends_on: t.depends_on || [],
      children: [],
      status: "pending" as const,
      retry_count: 0,
      max_retries: config.budget.max_failures_per_task,
    }));

    // 反向填充 children
    for (const task of tasks) {
      for (const depId of task.depends_on) {
        const parent = tasks.find(t => t.id === depId);
        if (parent && !parent.children.includes(task.id)) {
          parent.children.push(task.id);
        }
      }
    }

    return tasks;
  }
}

// ============================================================
// DAG Planner 门面
// ============================================================

export class DagPlanner {
  private strategy: DecompositionStrategy;

  constructor(llmClient?: LlmClient) {
    this.strategy = llmClient
      ? new LlmDecomposer(llmClient)
      : new RuleBasedDecomposer();
  }

  /**
   * 将目标拆解为任务 DAG
   */
  async plan(objective: string[], config: MissionConfig): Promise<TaskNode[]> {
    console.log(`  🧩 DAG Planner (${this.strategy.name}): 拆解目标...`);
    const dag = await this.strategy.decompose(objective, config);
    console.log(`  📊 生成 ${dag.length} 个任务节点`);

    // 打印 DAG 结构
    this.printDAG(dag);

    return dag;
  }

  /**
   * 获取当前可执行的任务（依赖已满足的）
   */
  static getRunnableTasks(dag: TaskNode[]): TaskNode[] {
    return dag.filter(task => {
      if (task.status !== "pending" && task.status !== "ready") return false;
      // 所有依赖必须已完成
      return task.depends_on.every(depId => {
        const dep = dag.find(t => t.id === depId);
        return dep && dep.status === "done";
      });
    });
  }

  /**
   * 检查 DAG 是否全部完成
   */
  static isComplete(dag: TaskNode[]): boolean {
    return dag.every(t => t.status === "done");
  }

  /**
   * 获取 DAG 进度摘要
   */
  static getProgress(dag: TaskNode[]): { done: number; total: number; failed: number } {
    return {
      done: dag.filter(t => t.status === "done").length,
      total: dag.length,
      failed: dag.filter(t => t.status === "failed").length,
    };
  }

  private printDAG(dag: TaskNode[]): void {
    for (const task of dag) {
      const deps = task.depends_on.length > 0 ? ` ← [${task.depends_on.join(", ")}]` : "";
      console.log(`    ${task.id}: ${task.description.slice(0, 60)}${deps}`);
    }
  }
}
