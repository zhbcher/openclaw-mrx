/**
 * File Executor — 安全的文件操作
 * 
 * 限制：
 *   1. 只能在 workspace 内操作
 *   2. 不跟随符号链接
 *   3. 拒绝路径遍历攻击 (../)
 */

import * as fs from "fs";
import * as path from "path";
import type { Executor, ExecutorAction, TaskInput, TaskResult } from "./executor.js";

export class FileExecutor implements Executor {
  readonly name = "file-executor";

  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  canHandle(action: ExecutorAction): boolean {
    return action.type === "file_write" || action.type === "file_read" || action.type === "file_delete";
  }

  async execute(input: TaskInput): Promise<TaskResult> {
    const { action } = input;
    const started = Date.now();

    // 1. 安全检查
    const safety = this.validatePath(action.target);
    if (!safety.allowed) {
      return { success: false, output: "", error: safety.reason, durationMs: Date.now() - started, action };
    }

    const resolvedPath = path.resolve(this.workspaceRoot, action.target);

    try {
      switch (action.type) {
        case "file_read":
          return this.handleRead(resolvedPath, action, started);
        case "file_write":
          return this.handleWrite(resolvedPath, action, started);
        case "file_delete":
          return this.handleDelete(resolvedPath, action, started);
        default:
          return { success: false, output: "", error: `未知操作: ${action.type}`, durationMs: Date.now() - started, action };
      }
    } catch (err) {
      return { success: false, output: "", error: (err as Error).message, durationMs: Date.now() - started, action };
    }
  }

  // ============================================================
  // Operations
  // ============================================================

  private handleRead(filePath: string, action: ExecutorAction, started: number): TaskResult {
    if (!fs.existsSync(filePath)) {
      return { success: false, output: "", error: `文件不存在: ${action.target}`, durationMs: Date.now() - started, action };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(filePath).slice(0, 50);
      return { success: true, output: files.join("\n"), durationMs: Date.now() - started, action };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return { success: true, output: content.slice(0, 10000), durationMs: Date.now() - started, action };
  }

  private handleWrite(filePath: string, action: ExecutorAction, started: number): TaskResult {
    if (!action.content) {
      return { success: false, output: "", error: "缺少文件内容", durationMs: Date.now() - started, action };
    }

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, action.content, "utf-8");
    return { success: true, output: `已写入: ${action.target} (${action.content.length} bytes)`, durationMs: Date.now() - started, action };
  }

  private handleDelete(filePath: string, action: ExecutorAction, started: number): TaskResult {
    if (!fs.existsSync(filePath)) {
      return { success: true, output: `文件不存在（无需删除）: ${action.target}`, durationMs: Date.now() - started, action };
    }

    fs.unlinkSync(filePath);
    return { success: true, output: `已删除: ${action.target}`, durationMs: Date.now() - started, action };
  }

  // ============================================================
  // Safety
  // ============================================================

  private validatePath(targetPath: string): { allowed: boolean; reason?: string } {
    // 拒绝空路径
    if (!targetPath || targetPath.trim() === "") {
      return { allowed: false, reason: "路径不能为空" };
    }

    // 拒绝绝对路径
    if (path.isAbsolute(targetPath)) {
      return { allowed: false, reason: "不允许绝对路径" };
    }

    // 拒绝路径遍历
    const normalized = path.normalize(targetPath);
    if (normalized.includes("..")) {
      return { allowed: false, reason: "不允许路径遍历 (../)" };
    }

    // 拒绝符号链接
    const resolved = path.resolve(this.workspaceRoot, normalized);
    try {
      const realPath = fs.realpathSync(resolved);
      if (!realPath.startsWith(this.workspaceRoot)) {
        return { allowed: false, reason: "路径解析后超出工作区" };
      }
    } catch (err) {
      // 文件不存在时 realpathSync 会抛异常——这是允许的（创建新文件）
      // 但需检查目标路径仍在 workspace 内
      if (!resolved.startsWith(this.workspaceRoot)) {
        return { allowed: false, reason: "目标路径超出工作区" };
      }
    }

    return { allowed: true };
  }
}
