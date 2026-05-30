/**
 * Executor — 任务执行抽象层
 * 
 * MRX V1 核心模块。在此之前 MRX 能规划但不能执行。
 * 所有 Executor 实现此接口。
 */

import type { AgentAdapter } from "../types.js";

export interface TaskInput {
  /** 任务描述 */
  description: string;
  /** 工作目录 */
  workingDir: string;
  /** 具体操作 */
  action: ExecutorAction;
}

export interface ExecutorAction {
  type: "shell" | "file_write" | "file_read" | "file_delete" | "tool";
  /** 命令（shell）或路径（file） */
  target: string;
  /** 可选参数 */
  content?: string;       // file_write 时使用
  /** 超时（ms） */
  timeoutMs?: number;
}

export interface TaskResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  action: ExecutorAction;
}

export interface Executor {
  /** 执行器名称 */
  readonly name: string;
  /** 执行单个任务 */
  execute(input: TaskInput): Promise<TaskResult>;
  /** 检查此执行器能否处理该 action */
  canHandle(action: ExecutorAction): boolean;
}
