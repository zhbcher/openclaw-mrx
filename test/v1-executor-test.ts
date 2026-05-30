/**
 * V1 集成测试 — Executor + Command + File + Security + Budget
 */

import { CommandExecutor } from "../core/executor/command-executor.js";
import { FileExecutor } from "../core/executor/file-executor.js";
import { ExecutorRegistry } from "../core/executor/executor-registry.js";
import { BudgetGuard } from "../core/budget/budget-guard.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("═".repeat(60));
  console.log("  MRX V1 验收测试: Executor + Security + Budget");
  console.log("═".repeat(60));

  let passed = 0, failed = 0;

  const workspaceDir = path.join(process.cwd(), "test", "v1_workspace");
  if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  // ============================================================
  // Test 1: Command Executor — 允许的命令
  // ============================================================
  console.log("\n📋 Test 1: Command Executor — 允许的命令");
  const cmdExec = new CommandExecutor(workspaceDir);
  {
    const result = await cmdExec.execute({
      description: "echo test",
      workingDir: workspaceDir,
      action: { type: "shell", target: "echo hello v1", timeoutMs: 5000 },
    });
    if (result.success && result.output.includes("hello v1")) {
      console.log(`   ✅ PASS: 命令执行成功 (${result.durationMs}ms)`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${result.error}`);
      failed++;
    }
  }

  // ============================================================
  // Test 2: Command Executor — 阻止 rm -rf
  // ============================================================
  console.log("\n📋 Test 2: Command Executor — 阻止 rm -rf");
  {
    const result = await cmdExec.execute({
      description: "dangerous command",
      workingDir: workspaceDir,
      action: { type: "shell", target: "rm -rf /tmp/test", timeoutMs: 5000 },
    });
    if (!result.success && result.error?.includes("被阻止")) {
      console.log("   ✅ PASS: 危险命令被正确阻止");
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该阻止但实际 success=${result.success}`);
      failed++;
    }
  }

  // ============================================================
  // Test 3: Command Executor — 阻止不在白名单的命令
  // ============================================================
  console.log("\n📋 Test 3: Command Executor — 白名单拦截");
  {
    const result = await cmdExec.execute({
      description: "blocked command",
      workingDir: workspaceDir,
      action: { type: "shell", target: "curl http://example.com", timeoutMs: 5000 },
    });
    if (!result.success && (result.error?.includes("被阻止") || result.error?.includes("不在白名单"))) {
      console.log("   ✅ PASS: 非白名单命令被拦截");
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该拦截 curl`);
      failed++;
    }
  }

  // ============================================================
  // Test 4: File Executor — 创建文件
  // ============================================================
  console.log("\n📋 Test 4: File Executor — 创建文件");
  const fileExec = new FileExecutor(workspaceDir);
  {
    const result = await fileExec.execute({
      description: "create test file",
      workingDir: workspaceDir,
      action: { type: "file_write", target: "test.txt", content: "Hello MRX V1" },
    });
    if (result.success && fs.existsSync(path.join(workspaceDir, "test.txt"))) {
      console.log("   ✅ PASS: 文件创建成功");
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${result.error}`);
      failed++;
    }
  }

  // ============================================================
  // Test 5: File Executor — 读取文件
  // ============================================================
  console.log("\n📋 Test 5: File Executor — 读取文件");
  {
    const result = await fileExec.execute({
      description: "read test file",
      workingDir: workspaceDir,
      action: { type: "file_read", target: "test.txt" },
    });
    if (result.success && result.output.includes("Hello MRX V1")) {
      console.log("   ✅ PASS: 文件读取成功");
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${result.error || result.output}`);
      failed++;
    }
  }

  // ============================================================
  // Test 6: File Executor — 阻止路径遍历
  // ============================================================
  console.log("\n📋 Test 6: File Executor — 路径遍历拦截");
  {
    const result = await fileExec.execute({
      description: "path traversal attack",
      workingDir: workspaceDir,
      action: { type: "file_read", target: "../../etc/passwd" },
    });
    if (!result.success && result.error?.includes("路径遍历")) {
      console.log("   ✅ PASS: 路径遍历被拦截");
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该拦截 ../`);
      failed++;
    }
  }

  // ============================================================
  // Test 7: File Executor — 阻止绝对路径
  // ============================================================
  console.log("\n📋 Test 7: File Executor — 绝对路径拦截");
  {
    const result = await fileExec.execute({
      description: "absolute path attack",
      workingDir: workspaceDir,
      action: { type: "file_read", target: "/etc/passwd" },
    });
    if (!result.success && result.error?.includes("绝对路径")) {
      console.log("   ✅ PASS: 绝对路径被拦截");
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该拦截绝对路径`);
      failed++;
    }
  }

  // ============================================================
  // Test 8: Executor Registry — 自动分发
  // ============================================================
  console.log("\n📋 Test 8: Executor Registry — 自动分发");
  {
    const registry = new ExecutorRegistry()
      .register(cmdExec)
      .register(fileExec);

    const results = await registry.executeAll([
      { description: "cmd", workingDir: workspaceDir, action: { type: "shell", target: "echo registry test" } },
      { description: "file", workingDir: workspaceDir, action: { type: "file_write", target: "reg.txt", content: "registry" } },
    ]);

    if (results.length === 2 && results[0].success && results[1].success) {
      console.log("   ✅ PASS: 自动分发 2 个不同类型的 action");
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${results.filter(r=>!r.success).length} 失败`);
      failed++;
    }
  }

  // ============================================================
  // Test 9: Executor Registry — 失败即停止
  // ============================================================
  console.log("\n📋 Test 9: Executor Registry — 失败即停止");
  {
    const registry = new ExecutorRegistry().register(cmdExec);
    const results = await registry.executeAll([
      { description: "will fail", workingDir: workspaceDir, action: { type: "shell", target: "curl blocked" } },
      { description: "should not run", workingDir: workspaceDir, action: { type: "shell", target: "echo never" } },
    ], true);

    if (results.length === 1 && !results[0].success) {
      console.log("   ✅ PASS: 第一个失败后正确停止");
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该停在第一个失败 (got ${results.length} results)`);
      failed++;
    }
  }

  // ============================================================
  // Test 10: Budget Guard — 正常状态
  // ============================================================
  console.log("\n📋 Test 10: Budget Guard — 正常状态");
  {
    const guard = new BudgetGuard({ maxIterations: 50, maxRuntimeMinutes: 30, maxFailures: 10, maxTokens: 100000 });
    const status = guard.check(10, 2, 5000);
    if (!status.exceeded && !status.shouldWarn) {
      console.log("   ✅ PASS: 预算正常 (无警告)");
      passed++;
    } else {
      console.log(`   ❌ FAIL: exceeded=${status.exceeded}`);
      failed++;
    }
  }

  // ============================================================
  // Test 11: Budget Guard — 超限警告
  // ============================================================
  console.log("\n📋 Test 11: Budget Guard — 超限警告");
  {
    const guard = new BudgetGuard({ maxIterations: 50, maxRuntimeMinutes: 30, maxFailures: 10, maxTokens: 100000 });
    const status = guard.check(45, 9, 90000);
    if (status.shouldWarn && !status.exceeded) {
      console.log(`   ✅ PASS: 触发警告: ${status.warnings.join("; ")}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: shouldWarn=${status.shouldWarn}`);
      failed++;
    }
  }

  // ============================================================
  // Test 12: Budget Guard — 超限
  // ============================================================
  console.log("\n📋 Test 12: Budget Guard — 超限");
  {
    const guard = new BudgetGuard({ maxIterations: 50, maxRuntimeMinutes: 30, maxFailures: 10, maxTokens: 100000 });
    const status = guard.check(51, 5, 50000);
    if (status.exceeded && status.exceededField === "iterations") {
      console.log("   ✅ PASS: 正确检测到超限 (iterations)");
      passed++;
    } else {
      console.log(`   ❌ FAIL: exceeded=${status.exceeded} field=${status.exceededField}`);
      failed++;
    }
  }

  // 清理
  if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true });

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  V1 结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
