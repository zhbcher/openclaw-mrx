/**
 * Mission DSL Parser — mission.yaml → MissionConfig
 * 
 * 职责：
 * 1. 读取并解析 mission.yaml
 * 2. 验证必填字段
 * 3. 设置默认值
 * 4. 返回类型安全的 MissionConfig
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { MissionConfig } from "../types.js";

export class MissionParser {
  /**
   * 从文件路径解析 Mission
   */
  static fromFile(configPath: string): MissionConfig {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Mission config file not found: ${configPath}`);
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    return MissionParser.parse(raw, configPath);
  }

  /**
   * 从 YAML 字符串解析 Mission
   */
  static parse(yamlStr: string, sourcePath?: string): MissionConfig {
    const raw = yaml.parse(yamlStr) as Record<string, unknown>;
    return MissionParser.validate(raw, sourcePath);
  }

  /**
   * 验证并补全默认值
   */
  private static validate(raw: Record<string, unknown>, sourcePath?: string): MissionConfig {
    // --- 必填字段检查 ---
    if (!raw.mission || typeof raw.mission !== "object") {
      throw new Error("mission.yaml 缺少顶层 mission 字段");
    }

    const m = raw.mission as Record<string, unknown>;

    if (!m.id) throw new Error("mission.id 是必填字段");
    if (!m.name) throw new Error("mission.name 是必填字段");
    if (!raw.objective) throw new Error("objective 是必填字段");
    if (!raw.context || typeof raw.context !== "object") {
      throw new Error("context 是必填字段");
    }

    const ctx = raw.context as Record<string, unknown>;
    if (!ctx.repo) throw new Error("context.repo 是必填字段");

    // --- 构建 MissionConfig，填充默认值 ---
    const config: MissionConfig = {
      version: (raw.version as number) || 1,
      mission: {
        id: m.id as string,
        name: m.name as string,
        description: (m.description as string) || "",
        priority: (m.priority as MissionConfig["mission"]["priority"]) || "medium",
      },
      objective: (raw.objective as string[]).map(String),
      context: {
        repo: ctx.repo as string,
        branch: ctx.branch as string | undefined,
      },
      constraints: (raw.constraints as string[])?.map(String) || [],
      environment: {
        working_dir: ((raw.environment as Record<string, unknown>)?.working_dir as string) || (ctx.repo as string),
        shell: ((raw.environment as Record<string, unknown>)?.shell as string) || "/bin/zsh",
        node_version: ((raw.environment as Record<string, unknown>)?.node_version as string),
      },
      validation: {
        commands: ((raw.validation as Record<string, unknown>)?.commands as string[])?.map(String) || [],
        e2e: ((raw.validation as Record<string, unknown>)?.e2e as string[])?.map(String),
        custom: ((raw.validation as Record<string, unknown>)?.custom as Array<{ script: string; description: string }>),
      },
      success_conditions: {
        type: ((raw.success_conditions as Record<string, unknown>)?.type as "all_of" | "any_of") || "all_of",
        conditions: ((raw.success_conditions as Record<string, unknown>)?.conditions as string[])?.map(String) || [],
      },
      budget: {
        max_tokens: ((raw.budget as Record<string, unknown>)?.max_tokens as number) || 1_000_000,
        max_duration_hours: ((raw.budget as Record<string, unknown>)?.max_duration_hours as number) || 4,
        max_cost_usd: ((raw.budget as Record<string, unknown>)?.max_cost_usd as number) || 10,
        max_iterations: ((raw.budget as Record<string, unknown>)?.max_iterations as number) || 20,
        max_failures_per_task: ((raw.budget as Record<string, unknown>)?.max_failures_per_task as number) || 3,
        warning_threshold: ((raw.budget as Record<string, unknown>)?.warning_threshold as number) || 0.8,
      },
      checkpoint: {
        enabled: ((raw.checkpoint as Record<string, unknown>)?.enabled as boolean) ?? true,
        strategy: ((raw.checkpoint as Record<string, unknown>)?.strategy as "phase" | "interval" | "manual") || "phase",
        interval_minutes: ((raw.checkpoint as Record<string, unknown>)?.interval_minutes as number) || 30,
      },
      memory: {
        enabled: ((raw.memory as Record<string, unknown>)?.enabled as boolean) ?? true,
        persist: ((raw.memory as Record<string, unknown>)?.persist as boolean) ?? true,
        compile_after: ((raw.memory as Record<string, unknown>)?.compile_after as boolean) ?? false,
      },
      risk_policy: {
        require_approval: ((raw.risk_policy as Record<string, unknown>)?.require_approval as string[]) || [],
        block: ((raw.risk_policy as Record<string, unknown>)?.block as string[]) || ["outside_working_dir"],
      },
      human_interaction: {
        mode: ((raw.human_interaction as Record<string, unknown>)?.mode as MissionConfig["human_interaction"]["mode"]) || "ask_when_blocked",
        notification: ((raw.human_interaction as Record<string, unknown>)?.notification as string[]) || ["escalate", "complete"],
      },
      autonomy: {
        retry_enabled: ((raw.autonomy as Record<string, unknown>)?.retry_enabled as boolean) ?? true,
        self_healing: ((raw.autonomy as Record<string, unknown>)?.self_healing as boolean) ?? false,
        auto_continue: ((raw.autonomy as Record<string, unknown>)?.auto_continue as boolean) ?? false,
      },
    };

    // --- 验证 working_dir 是否存在 ---
    const absDir = path.resolve(config.environment.working_dir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`Mission working_dir 不存在: ${absDir}\n完整路径: ${absDir}`);
    }
    config.environment.working_dir = absDir;

    return config;
  }

  /**
   * 生成 Mission 配置模板
   */
  static generateTemplate(name: string, repo: string): string {
    const template: MissionConfig = {
      version: 1,
      mission: {
        id: `mission-${name.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        description: "",
        priority: "medium",
      },
      objective: ["[请填写目标]"],
      context: { repo },
      constraints: [],
      environment: { working_dir: repo },
      validation: { commands: [] },
      success_conditions: { type: "all_of", conditions: [] },
      budget: {
        max_tokens: 1_000_000,
        max_duration_hours: 4,
        max_cost_usd: 10,
        max_iterations: 20,
        max_failures_per_task: 3,
        warning_threshold: 0.8,
      },
      checkpoint: { enabled: true, strategy: "phase" },
      memory: { enabled: true, persist: true, compile_after: false },
      risk_policy: { require_approval: [], block: ["outside_working_dir"] },
      human_interaction: { mode: "ask_when_blocked", notification: ["escalate", "complete"] },
      autonomy: { retry_enabled: true, self_healing: false, auto_continue: false },
    };
    return yaml.stringify(template, { indent: 2, lineWidth: 0 });
  }
}
