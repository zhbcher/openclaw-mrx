/**
 * Verifier Chain — 三层验证链
 * 
 * V1 问题：只跑 npm test / npm build，测试通过 ≠ 目标达成。
 * V2：分层验证，每层有明确的通过/失败标准。
 * ECC 融合：ECC 规则审计在 loop-engine.ts 的 validateWithECC() 中执行。
 * 
 * 结构：
 *   SyntaxVerifier    → 语法无错误
 *        ↓
 *   BuildVerifier     → 构建成功
 *        ↓
 *   TestVerifier      → 测试通过
 *        ↓
 *   GoalVerifier      → 目标达成（自定义验证）
 */

import type { AgentAdapter, VerificationRecord } from "../types.js";

// ============================================================
// 验证器接口
// ============================================================

export interface VerifierCheck {
  name: string;
  description: string;
  /** 实际执行验证 */
  run(adapter: AgentAdapter, workingDir: string): Promise<VerifierCheckResult>;
}

export interface VerifierCheckResult {
  passed: boolean;
  command?: string;
  output?: string;
  error?: string;
  duration_ms: number;
}

export interface ChainResult {
  passed: boolean;
  stage: string;             // 在哪一层失败
  results: VerifierCheckResult[];
  summary: string;
}

// ============================================================
// 语法验证
// ============================================================

export class SyntaxVerifier implements VerifierCheck {
  name = "syntax";
  description = "语法检查（TypeScript/Python/Lint）";

  async run(adapter: AgentAdapter, workingDir: string): Promise<VerifierCheckResult> {
    const started = Date.now();

    // 尝试 TypeScript 类型检查
    const tscResult = await adapter.executeCommand("npx tsc --noEmit 2>&1 | tail -5", workingDir);

    if (tscResult.success && !tscResult.output?.includes("error TS")) {
      return {
        passed: true,
        command: "npx tsc --noEmit",
        output: tscResult.output || "No type errors",
        duration_ms: Date.now() - started,
      };
    }

    // 尝试 ESLint
    const lintResult = await adapter.executeCommand("npx eslint --max-warnings 0 . 2>&1 | tail -5", workingDir);
    if (lintResult.success) {
      return {
        passed: true,
        command: "npx eslint",
        output: lintResult.output || "Lint passed",
        duration_ms: Date.now() - started,
      };
    }

    return {
      passed: false,
      command: "syntax check",
      error: tscResult.error || "Syntax/lint checks failed",
      duration_ms: Date.now() - started,
    };
  }
}

// ============================================================
// 构建验证
// ============================================================

export class BuildVerifier implements VerifierCheck {
  name = "build";
  description = "构建验证（编译/打包）";

  async run(adapter: AgentAdapter, workingDir: string): Promise<VerifierCheckResult> {
    const started = Date.now();

    // npm build
    const result = await adapter.executeCommand("npm run build 2>&1 | tail -10", workingDir);

    if (result.success) {
      return {
        passed: true,
        command: "npm run build",
        output: result.output?.slice(0, 200) || "Build succeeded",
        duration_ms: Date.now() - started,
      };
    }

    return {
      passed: false,
      command: "npm run build",
      error: result.error?.slice(0, 300) || "Build failed",
      duration_ms: Date.now() - started,
    };
  }
}

// ============================================================
// 测试验证
// ============================================================

export class TestVerifier implements VerifierCheck {
  name = "test";
  description = "测试验证（单元测试/集成测试）";

  async run(adapter: AgentAdapter, workingDir: string): Promise<VerifierCheckResult> {
    const started = Date.now();

    const result = await adapter.executeCommand("npm test 2>&1 | tail -15", workingDir);

    if (result.success) {
      return {
        passed: true,
        command: "npm test",
        output: result.output?.slice(0, 200) || "Tests passed",
        duration_ms: Date.now() - started,
      };
    }

    return {
      passed: false,
      command: "npm test",
      error: result.error?.slice(0, 300) || "Tests failed",
      duration_ms: Date.now() - started,
    };
  }
}

// ============================================================
// Goal 验证（自定义验证逻辑）
// ============================================================

export interface GoalVerifierConfig {
  /** 自定义验证命令 */
  commands?: string[];
  /** 预期输出包含的关键词 */
  expectedOutput?: string[];
  /** 预期文件变更（路径 glob） */
  expectedFiles?: string[];
}

export class GoalVerifier implements VerifierCheck {
  name = "goal";
  description = "目标级验证（自定义命令 + 输出检测 + 文件变更检测）";
  private config: GoalVerifierConfig;

  constructor(config?: GoalVerifierConfig) {
    this.config = config || {};
  }

  async run(adapter: AgentAdapter, workingDir: string): Promise<VerifierCheckResult> {
    const started = Date.now();
    const checks: string[] = [];

    // 1. 运行自定义验证命令
    if (this.config.commands && this.config.commands.length > 0) {
      for (const cmd of this.config.commands) {
        const result = await adapter.executeCommand(cmd, workingDir);
        if (!result.success) {
          return {
            passed: false,
            command: cmd,
            error: result.error?.slice(0, 200) || `Command failed: ${cmd}`,
            duration_ms: Date.now() - started,
          };
        }
        checks.push(`✅ ${cmd}`);
      }
    }

    // 2. 检查预期输出
    if (this.config.expectedOutput && this.config.expectedOutput.length > 0) {
      for (const expected of this.config.expectedOutput) {
        // 尝试 grep
        const result = await adapter.executeCommand(
          `grep -r "${expected}" . --include="*.ts" --include="*.js" --include="*.html" 2>/dev/null | head -3`,
          workingDir
        );
        if (!result.success || !result.output?.trim()) {
          return {
            passed: false,
            command: `grep "${expected}"`,
            error: `预期输出 "${expected}" 未找到`,
            duration_ms: Date.now() - started,
          };
        }
        checks.push(`✅ 输出包含: "${expected}"`);
      }
    }

    // 3. 检查文件变更
    if (this.config.expectedFiles && this.config.expectedFiles.length > 0) {
      for (const fileGlob of this.config.expectedFiles) {
        const result = await adapter.executeCommand(`ls ${fileGlob} 2>/dev/null | head -3`, workingDir);
        if (!result.success || !result.output?.trim()) {
          return {
            passed: false,
            command: `ls ${fileGlob}`,
            error: `预期文件 "${fileGlob}" 不存在`,
            duration_ms: Date.now() - started,
          };
        }
        checks.push(`✅ 文件存在: ${result.output.trim().split("\n")[0]}`);
      }
    }

    return {
      passed: true,
      command: "goal verification",
      output: checks.join("\n") || "No custom goal checks configured — passed by default",
      duration_ms: Date.now() - started,
    };
  }
}

// ============================================================
// Verifier Chain — 链式编排
// ============================================================

export class VerifierChain {
  private verifiers: VerifierCheck[];

  constructor(verifiers?: VerifierCheck[]) {
    this.verifiers = verifiers || [
      new SyntaxVerifier(),
      new BuildVerifier(),
      new TestVerifier(),
    ];
  }

  /** 添加验证器 */
  add(verifier: VerifierCheck): this {
    this.verifiers.push(verifier);
    return this;
  }

  /**
   * 在链尾追加 ECC 规则审计
   * 异步导入 ECCVerifier，确保 ECC 模块不存在时不报错
   */

  /**
   * 按顺序执行所有验证器，遇到失败立即停止
   */
  async execute(adapter: AgentAdapter, workingDir: string): Promise<ChainResult> {
    const results: VerifierCheckResult[] = [];

    for (const verifier of this.verifiers) {
      const result = await verifier.run(adapter, workingDir);
      results.push(result);

      if (!result.passed) {
        return {
          passed: false,
          stage: verifier.name,
          results,
          summary: `❌ 验证失败在 ${verifier.name} 层 (${result.error?.slice(0, 80) || result.command})`,
        };
      }
    }

    return {
      passed: true,
      stage: "all",
      results,
      summary: `✅ 全部 ${this.verifiers.length} 层验证通过`,
    };
  }

  /** 获取验证链描述 */
  describe(): string {
    return this.verifiers.map((v, i) => `  ${i + 1}. ${v.name}: ${v.description}`).join("\n");
  }
}
