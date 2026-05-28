/**
 * Memory Compiler — 执行过程 → 结构化知识
 * 
 * Phase 3 核心模块。将 Mission 执行过程中的所有数据
 * 编译为五层记忆结构。
 * 
 * 五层记忆：
 *   Working Memory   → 当前循环上下文（内存，不持久化）
 *   Episodic Memory  → 历史步骤记录（events/）
 *   Semantic Memory  → 项目知识（架构、约定、技术栈）
 *   Procedural Memory → 修复套路（"这类问题怎么修"）
 *   Long-term Memory → 长期工程经验（跨 Mission）
 */

import * as fs from "fs";
import * as path from "path";
import type { MissionState, MissionConfig, VerificationRecord, JudgementRecord } from "../types.js";
import type { LlmClient } from "../planner/dag-planner.js";

// ============================================================
// 记忆条目类型
// ============================================================

export interface MemoryEntry {
  id: string;
  type: "decision" | "failure" | "solution" | "pattern" | "knowledge";
  mission_id: string;
  timestamp: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
}

export interface CompiledMemory {
  decisions: MemoryEntry[];
  failures: MemoryEntry[];
  solutions: MemoryEntry[];
  patterns: MemoryEntry[];
  knowledge: MemoryEntry[];
}

// ============================================================
// Memory Compiler
// ============================================================

const COMPILER_SYSTEM_PROMPT = `你是一个工程知识编译专家。从 Agent 执行记录中提取有价值的工程知识。

输出 JSON 格式：
{
  "entries": [
    {
      "type": "decision|failure|solution|pattern|knowledge",
      "title": "简短标题",
      "content": "详细内容（包含上下文、原因、解决方法、教训）",
      "tags": ["tag1", "tag2"]
    }
  ]
}

提取原则：
1. decisions: 做出的关键技术决策及原因
2. failures: 遇到的错误、根因、修复方法
3. solutions: 可复用的解决方案模式
4. patterns: 反复出现的问题模式
5. knowledge: 项目特有的架构约定、技术栈信息

只提取有长期价值的内容。不要重复记录相同的信息。`;

export class MemoryCompiler {
  private llm?: LlmClient;
  private memoryDir: string;

  constructor(memoryDir: string, llm?: LlmClient) {
    this.memoryDir = memoryDir;
    this.llm = llm;
  }

  /**
   * 编译 Mission 执行过程为结构化记忆
   */
  async compile(state: MissionState, config: MissionConfig): Promise<CompiledMemory> {
    console.log("  🧠 Memory Compiler: 编译执行知识...");

    // 1. 规则提取（快速路径）
    const ruleBased = this.ruleBasedExtraction(state, config);

    // 2. LLM 深度提取
    let llmBased: MemoryEntry[] = [];
    if (this.llm) {
      try {
        llmBased = await this.llmExtraction(state, config);
      } catch (err) {
        console.log(`  ⚠️  LLM 记忆提取失败: ${(err as Error).message}`);
      }
    }

    // 3. 合并去重
    const allEntries = [...ruleBased, ...llmBased];
    const compiled = this.mergeAndDedupe(allEntries);

    // 4. 写入磁盘
    this.persist(compiled, config.mission.id);

    console.log(`  📊 编译完成: ${compiled.decisions.length} 决策, ${compiled.failures.length} 失败, ${compiled.solutions.length} 方案, ${compiled.patterns.length} 模式, ${compiled.knowledge.length} 知识`);
    return compiled;
  }

  /**
   * 规则提取：从验证历史和裁决历史中提取基本信息
   */
  private ruleBasedExtraction(state: MissionState, config: MissionConfig): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const missionId = config.mission.id;

    // 提取失败记录
    for (const v of state.verification_history) {
      if (!v.passed) {
        const failedCmds = v.checks.filter(c => !c.passed).map(c => c.command);
        entries.push({
          id: `fail_${v.iteration}_${v.task_id}`,
          type: "failure",
          mission_id: missionId,
          timestamp: v.timestamp,
          title: `验证失败: ${v.task_id}`,
          content: `第 ${v.iteration} 轮验证失败。失败命令: ${failedCmds.join(", ")}。${v.summary}`,
          tags: ["verification-failed", ...failedCmds.map(c => c.split(" ")[0])],
          confidence: 0.9,
        });
      }
    }

    // 提取裁决决策
    for (const j of state.judgement_history) {
      if (j.verdict === "escalate" || j.verdict === "replan") {
        entries.push({
          id: `decision_${j.iteration}`,
          type: "decision",
          mission_id: missionId,
          timestamp: j.timestamp,
          title: `${j.verdict}: ${j.reason.slice(0, 80)}`,
          content: `第 ${j.iteration} 轮裁决: ${j.verdict}。原因: ${j.reason}`,
          tags: ["decision", j.verdict],
          confidence: 0.85,
        });
      }
    }

    return entries;
  }

  /**
   * LLM 深度提取
   */
  private async llmExtraction(state: MissionState, config: MissionConfig): Promise<MemoryEntry[]> {
    if (!this.llm) return [];

    const summary = this.buildExecutionSummary(state, config);
    const response = await this.llm.chat(summary, COMPILER_SYSTEM_PROMPT);
    const json = this.extractJSON(response);

    return ((json.entries || []) as Array<{
      type: MemoryEntry["type"];
      title: string;
      content: string;
      tags: string[];
    }>).map((e, i) => ({
      id: `llm_${Date.now()}_${i}`,
      type: e.type,
      mission_id: config.mission.id,
      timestamp: new Date().toISOString(),
      title: e.title,
      content: e.content,
      tags: e.tags || [],
      confidence: 0.7,
    }));
  }

  private buildExecutionSummary(state: MissionState, config: MissionConfig): string {
    const lines = [
      `Mission: ${config.mission.name}`,
      `描述: ${config.mission.description}`,
      `目标: ${config.objective.join("; ")}`,
      `总循环数: ${state.current_iteration}`,
      `验证次数: ${state.verification_history.length}`,
      `任务数: ${state.task_tree.length}`,
      ``,
      `验证历史:`,
      ...state.verification_history.map(v =>
        `  #${v.iteration} ${v.passed ? "✅" : "❌"} ${v.summary}`
      ),
      ``,
      `裁决历史:`,
      ...state.judgement_history.map(j =>
        `  #${j.iteration} ${j.verdict}: ${j.reason}`
      ),
    ];
    return lines.join("\n");
  }

  private mergeAndDedupe(entries: MemoryEntry[]): CompiledMemory {
    const result: CompiledMemory = {
      decisions: [],
      failures: [],
      solutions: [],
      patterns: [],
      knowledge: [],
    };

    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.type}:${entry.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result[`${entry.type}s` as keyof CompiledMemory]?.push(entry);
    }

    return result;
  }

  private persist(memory: CompiledMemory, missionId: string): void {
    const dir = path.join(this.memoryDir, missionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 分类型写入
    for (const [type, entries] of Object.entries(memory)) {
      if (entries.length === 0) continue;
      const filePath = path.join(dir, `${type}.md`);
      const content = this.formatAsMarkdown(type, entries as MemoryEntry[]);
      fs.writeFileSync(filePath, content, "utf-8");
    }

    // 写入汇总索引
    const index = this.buildIndex(memory, missionId);
    fs.writeFileSync(path.join(dir, "INDEX.md"), index, "utf-8");
  }

  private formatAsMarkdown(type: string, entries: MemoryEntry[]): string {
    const typeLabel: Record<string, string> = {
      decisions: "决策记录",
      failures: "失败记录",
      solutions: "解决方案",
      patterns: "模式识别",
      knowledge: "项目知识",
    };

    const lines = [`# ${typeLabel[type] || type}`, "", `> Mission 自动编译 | ${entries.length} 条`, ""];

    for (const entry of entries) {
      lines.push(`## ${entry.title}`);
      lines.push("");
      lines.push(`- **时间**: ${entry.timestamp}`);
      lines.push(`- **标签**: ${entry.tags.join(", ")}`);
      lines.push(`- **可信度**: ${Math.round(entry.confidence * 100)}%`);
      lines.push("");
      lines.push(entry.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  private buildIndex(memory: CompiledMemory, missionId: string): string {
    const lines = [`# Mission 记忆索引`, "", `> Mission: ${missionId} | 自动编译`, ""];

    const sections: Array<{ key: keyof CompiledMemory; label: string; icon: string }> = [
      { key: "decisions", label: "决策记录", icon: "🧭" },
      { key: "failures", label: "失败记录", icon: "❌" },
      { key: "solutions", label: "解决方案", icon: "💡" },
      { key: "patterns", label: "模式识别", icon: "🔄" },
      { key: "knowledge", label: "项目知识", icon: "📚" },
    ];

    for (const { key, label, icon } of sections) {
      const entries = memory[key];
      lines.push(`## ${icon} ${label} (${entries.length})`);
      for (const entry of entries) {
        lines.push(`- ${entry.title} \`${entry.tags.slice(0, 3).join(", ")}\``);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private extractJSON(response: string): Record<string, unknown> {
    const match = response.match(/```json\s*([\s\S]*?)```/) ||
                  response.match(/```\s*([\s\S]*?)```/) ||
                  [null, response];
    return JSON.parse((match[1] || response).trim());
  }
}
