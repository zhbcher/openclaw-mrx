/**
 * Command Executor — 安全执行 Shell 命令
 * 
 * 安全机制：
 *   1. Allowlist：只允许白名单命令
 *   2. Workspace Boundary：限制文件访问范围
 *   3. Timeout：每个命令有超时限制
 */

import { execSync } from "child_process";
import * as path from "path";
import type { Executor, ExecutorAction, TaskInput, TaskResult } from "./executor.js";

// ============================================================
// Allowlist
// ============================================================

const ALLOWED_COMMANDS = new Set([
  "npm", "npx", "node", "tsc", "tsx",
  "python", "python3", "pytest",
  "git", "echo", "cat", "ls", "grep", "find", "wc",
  "mkdir", "touch", "cp", "mv",
]);

const ALLOWED_PHRASES = new Set([
  "npm test", "npm run build", "npm run lint",
  "npx tsc --noEmit", "npx jest",
]);

const BLOCKED_COMMANDS = [
  "rm -rf", "rm -r", "sudo", "shutdown", "reboot", "halt",
  "curl", "wget", "nc", "telnet",
  "chmod 777", "chown",
  "kill", "killall", "pkill",
  "> /dev/", "dd if=", "mkfs",
  "eval", "exec",
];

export class CommandExecutor implements Executor {
  readonly name = "command-executor";

  private workingDirBoundary: string;

  constructor(workingDirBoundary: string) {
    this.workingDirBoundary = path.resolve(workingDirBoundary);
  }

  canHandle(action: ExecutorAction): boolean {
    return action.type === "shell";
  }

  async execute(input: TaskInput): Promise<TaskResult> {
    const { action, workingDir } = input;
    const started = Date.now();

    // 1. Allowlist 检查
    const allowlistResult = this.checkAllowlist(action.target);
    if (!allowlistResult.allowed) {
      return {
        success: false,
        output: "",
        error: `命令被阻止: ${allowlistResult.reason}`,
        durationMs: Date.now() - started,
        action,
      };
    }

    // 2. Workspace boundary 检查
    const boundaryResult = this.checkBoundary(workingDir);
    if (!boundaryResult.allowed) {
      return {
        success: false,
        output: "",
        error: `路径越界: ${boundaryResult.reason}`,
        durationMs: Date.now() - started,
        action,
      };
    }

    // 3. 执行
    try {
      const output = execSync(action.target, {
        cwd: workingDir,
        encoding: "utf-8",
        timeout: action.timeoutMs || 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      });

      return {
        success: true,
        output: output.slice(0, 5000),
        durationMs: Date.now() - started,
        action,
      };
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout?.slice(0, 2000) || "",
        error: err.stderr?.slice(0, 2000) || err.message,
        durationMs: Date.now() - started,
        action,
      };
    }
  }

  // ============================================================
  // Safety checks
  // ============================================================

  private checkAllowlist(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();

    // 先检查 blocked
    for (const blocked of BLOCKED_COMMANDS) {
      if (trimmed.includes(blocked)) {
        return { allowed: false, reason: `包含被阻止的模式: "${blocked}"` };
      }
    }

    // 2. 基础命令白名单 (O(1) 查找)
    const baseCmd = trimmed.split(" ")[0];
    if (ALLOWED_COMMANDS.has(baseCmd)) return { allowed: true };

    // 3. 完整短语白名单
    if (ALLOWED_PHRASES.has(trimmed)) return { allowed: true };

    return { allowed: false, reason: `命令不在白名单中: "${baseCmd}"` };
  }

  private checkBoundary(workingDir: string): { allowed: boolean; reason?: string } {
    const resolved = path.resolve(workingDir);

    // 检查是否在 workspace 内
    if (!resolved.startsWith(this.workingDirBoundary)) {
      // 允许测试目录
      if (!resolved.includes("test") && !resolved.includes("temp")) {
        return { allowed: false, reason: `工作目录 "${resolved}" 超出允许范围 "${this.workingDirBoundary}"` };
      }
    }

    return { allowed: true };
  }
}
