/**
 * Validator — 外部命令验证器
 * 
 * 核心铁律：不让 LLM 自己判断自己是否成功。
 * 所有验证都走外部命令（npm test / tsc / curl 等）。
 * 
 * Phase 1：基于 exec 的简单命令验证。
 * Phase 2+：增加 Playwright E2E、API curl 等验证类型。
 */

import { execSync } from "child_process";
import type { VerificationRecord, AgentAdapter } from "../types.js";

export class Validator {
  private adapter: AgentAdapter;

  constructor(adapter: AgentAdapter) {
    this.adapter = adapter;
  }

  /**
   * 执行一组验证命令
   */
  async runAll(
    commands: string[],
    workingDir: string,
    iteration: number,
    taskId: string
  ): Promise<VerificationRecord> {
    const checks: VerificationRecord["checks"] = [];

    for (const cmd of commands) {
      const result = await this.adapter.executeCommand(cmd, workingDir);
      checks.push({
        command: cmd,
        passed: result.success,
        output: result.output?.slice(0, 500),  // 截断过长输出
        error: result.error?.slice(0, 500),
        duration_ms: result.duration_ms,
      });
    }

    const allPassed = checks.every(c => c.passed);
    const failedCount = checks.filter(c => !c.passed).length;

    const record: VerificationRecord = {
      iteration,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      passed: allPassed,
      checks,
      summary: allPassed
        ? `全部 ${checks.length} 项验证通过`
        : `${failedCount}/${checks.length} 项验证失败`,
    };

    return record;
  }

  /**
   * 执行单个验证命令（同步版本，用于快速检查）
   */
  runSingle(command: string, cwd: string): { passed: boolean; output: string; error?: string } {
    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf-8",
        timeout: 120_000, // 2 分钟超时
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return { passed: true, output: output.slice(0, 1000) };
    } catch (err: any) {
      return {
        passed: false,
        output: err.stdout?.slice(0, 500) || "",
        error: err.stderr?.slice(0, 500) || err.message,
      };
    }
  }
}
