/**
 * Executor Registry — 管理所有 Executor，根据 action 类型自动分发
 */

import type { Executor, ExecutorAction, TaskInput, TaskResult } from "./executor.js";

export class ExecutorRegistry {
  private executors: Executor[] = [];

  register(executor: Executor): this {
    this.executors.push(executor);
    return this;
  }

  /** 找到能处理此 action 的执行器并执行 */
  async dispatch(input: TaskInput): Promise<TaskResult> {
    for (const executor of this.executors) {
      if (executor.canHandle(input.action)) {
        console.log(`  ⚡ ${executor.name}: ${input.action.type} → ${input.action.target.slice(0, 60)}`);
        return executor.execute(input);
      }
    }

    return {
      success: false,
      output: "",
      error: `没有执行器能处理 action.type="${input.action.type}"`,
      durationMs: 0,
      action: input.action,
    };
  }

  /** 列出所有注册的执行器 */
  list(): string[] {
    return this.executors.map(e => e.name);
  }

  /** 批量执行（顺序执行，任一失败即停止） */
  async executeAll(inputs: TaskInput[], stopOnError = true): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    for (const input of inputs) {
      const result = await this.dispatch(input);
      results.push(result);

      if (!result.success && stopOnError) {
        console.log(`  ⛔ 执行失败，停止后续任务: ${result.error}`);
        break;
      }
    }

    return results;
  }
}
