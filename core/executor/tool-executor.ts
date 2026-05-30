/**
 * Tool Executor — 统一 Tool 接口，封装常用开发工具
 * 
 * 每个 Tool 有明确的：
 *   - name: 工具标识
 *   - description: 人类可读说明
 *   - parameters: JSON Schema 参数定义
 *   - execute: 执行逻辑
 *   - riskLevel: 安全风险等级
 */

import type { Executor, ExecutorAction, TaskInput, TaskResult } from "./executor.js";
import { execSync } from "child_process";
import * as path from "path";

// ============================================================
// Tool 接口
// ============================================================

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  execute(params: Record<string, unknown>, workingDir: string): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// ============================================================
// 内置工具
// ============================================================

export class GitStatusTool implements Tool {
  readonly name = "git.status";
  readonly description = "查看 Git 仓库状态";
  readonly riskLevel: RiskLevel = "safe";

  async execute(_params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    try {
      const output = execSync("git status --short", { cwd: workingDir, encoding: "utf-8", timeout: 30000 });
      return { success: true, output: output || "(clean)", durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: "", error: err.stderr || err.message, durationMs: Date.now() - started };
    }
  }
}

export class GitCommitTool implements Tool {
  readonly name = "git.commit";
  readonly description = "提交 Git 变更";
  readonly riskLevel: RiskLevel = "medium";

  async execute(params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    const message = params.message as string;
    if (!message || message.length < 3) {
      return { success: false, output: "", error: "commit message 至少 3 个字符", durationMs: 0 };
    }
    try {
      const output = execSync(`git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: workingDir, encoding: "utf-8", timeout: 30000,
      });
      return { success: true, output: output.trim(), durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: err.stdout || "", error: err.stderr || err.message, durationMs: Date.now() - started };
    }
  }
}

export class NpmTestTool implements Tool {
  readonly name = "npm.test";
  readonly description = "运行 npm test";
  readonly riskLevel: RiskLevel = "safe";

  async execute(_params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    try {
      const output = execSync("npm test 2>&1 | tail -20", { cwd: workingDir, encoding: "utf-8", timeout: 120000 });
      return { success: true, output, durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: err.stdout?.slice(0, 1000) || "", error: err.stderr?.slice(0, 500) || err.message, durationMs: Date.now() - started };
    }
  }
}

export class NpmBuildTool implements Tool {
  readonly name = "npm.build";
  readonly description = "运行 npm run build";
  readonly riskLevel: RiskLevel = "safe";

  async execute(_params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    try {
      const output = execSync("npm run build 2>&1 | tail -10", { cwd: workingDir, encoding: "utf-8", timeout: 120000 });
      return { success: true, output, durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: err.stdout?.slice(0, 500) || "", error: err.stderr?.slice(0, 500) || err.message, durationMs: Date.now() - started };
    }
  }
}

export class NpmInstallTool implements Tool {
  readonly name = "npm.install";
  readonly description = "安装 npm 依赖";
  readonly riskLevel: RiskLevel = "low";

  async execute(_params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    try {
      const output = execSync("npm install 2>&1 | tail -5", { cwd: workingDir, encoding: "utf-8", timeout: 180000 });
      return { success: true, output, durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: err.stdout || "", error: err.stderr || err.message, durationMs: Date.now() - started };
    }
  }
}

export class LintTool implements Tool {
  readonly name = "lint";
  readonly description = "运行代码检查";
  readonly riskLevel: RiskLevel = "safe";

  async execute(_params: Record<string, unknown>, workingDir: string): Promise<ToolResult> {
    const started = Date.now();
    try {
      // 尝试 TypeScript 检查
      const tsOutput = execSync("npx tsc --noEmit 2>&1 | tail -5", { cwd: workingDir, encoding: "utf-8", timeout: 60000 });
      if (!tsOutput.includes("error TS")) {
        return { success: true, output: "TypeScript: no errors", durationMs: Date.now() - started };
      }
      return { success: false, output: tsOutput, error: "TypeScript errors found", durationMs: Date.now() - started };
    } catch (err: any) {
      return { success: false, output: err.stdout?.slice(0, 1000) || "", error: "Lint failed", durationMs: Date.now() - started };
    }
  }
}

// ============================================================
// Tool Executor — 将 Tool 适配为 Executor 接口
// ============================================================

export class ToolExecutor implements Executor {
  readonly name = "tool-executor";
  private tools: Map<string, Tool> = new Map();

  constructor(tools?: Tool[]) {
    if (tools) {
      for (const t of tools) this.register(t);
    }
  }

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(): Array<{ name: string; description: string; riskLevel: RiskLevel }> {
    return [...this.tools.values()].map(t => ({
      name: t.name, description: t.description, riskLevel: t.riskLevel,
    }));
  }

  canHandle(action: ExecutorAction): boolean {
    return action.type === "tool" && this.tools.has(action.target);
  }

  async execute(input: TaskInput): Promise<TaskResult> {
    const { action, workingDir } = input;
    const started = Date.now();
    const tool = this.tools.get(action.target);

    if (!tool) {
      return { success: false, output: "", error: `未知工具: ${action.target}`, durationMs: Date.now() - started, action };
    }

    // 高风险工具需要确认
    if (tool.riskLevel === "high" || tool.riskLevel === "critical") {
      return {
        success: false, output: "",
        error: `工具 "${tool.name}" 风险等级为 ${tool.riskLevel}，需要人工审批`,
        durationMs: Date.now() - started, action,
      };
    }

    const params = action.content ? JSON.parse(action.content) : {};
    const result = await tool.execute(params, workingDir);

    return {
      success: result.success,
      output: result.output.slice(0, 5000),
      error: result.error,
      durationMs: result.durationMs,
      action,
    };
  }
}

/**
 * 创建默认工具集
 */
export function createDefaultTools(): Tool[] {
  return [
    new GitStatusTool(),
    new GitCommitTool(),
    new NpmTestTool(),
    new NpmBuildTool(),
    new NpmInstallTool(),
    new LintTool(),
  ];
}
