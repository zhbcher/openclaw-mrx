/**
 * OpenClaw Adapter — AgentAdapter 的 OpenClaw 实现
 * 
 * 将 MRX 的工具调用映射到 OpenClaw 的工具（exec / read / write）。
 * 所有平台相关的差异封装在 adapter 层，核心引擎只看到统一接口。
 * 
 * Phase 1：基础文件 + 命令执行
 * Phase 2+：增加 browser、git、search 等更多工具
 */

import * as fs from "fs";
import { execSync } from "child_process";
import type { AgentAdapter, ToolResult } from "../core/types.js";

export class OpenClawAdapter implements AgentAdapter {
  readonly name = "openclaw";

  /**
   * 执行 shell 命令
   */
  async executeCommand(command: string, cwd: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf-8",
        timeout: 300_000, // 5 分钟
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env },
      });
      return {
        success: true,
        output,
        duration_ms: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout || "",
        error: err.stderr || err.message || "命令执行失败",
        duration_ms: Date.now() - start,
      };
    }
  }

  /**
   * 读取文件
   */
  async readFile(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * 写入文件
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const dir = filePath.split("/").slice(0, -1).join("/");
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, "utf-8");
      return {
        success: true,
        output: `文件已写入: ${filePath}`,
        duration_ms: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        duration_ms: Date.now() - start,
      };
    }
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(filePath: string): Promise<boolean> {
    return fs.existsSync(filePath);
  }

  /**
   * 获取 git 状态（Phase 1 基础实现）
   */
  async getGitStatus(cwd: string): Promise<{
    branch: string;
    changedFiles: string[];
    untrackedFiles: string[];
    ahead: number;
    behind: number;
  }> {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd, encoding: "utf-8", timeout: 10_000,
      }).trim();

      const statusOutput = execSync("git status --porcelain", {
        cwd, encoding: "utf-8", timeout: 10_000,
      });

      const lines = statusOutput.trim().split("\n").filter(Boolean);
      const changedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      for (const line of lines) {
        const statusCode = line.substring(0, 2);
        const file = line.substring(3);
        if (statusCode.includes("?")) {
          untrackedFiles.push(file);
        } else {
          changedFiles.push(file);
        }
      }

      return {
        branch,
        changedFiles,
        untrackedFiles,
        ahead: 0,
        behind: 0,
      };
    } catch {
      return {
        branch: "unknown",
        changedFiles: [],
        untrackedFiles: [],
        ahead: 0,
        behind: 0,
      };
    }
  }
}
