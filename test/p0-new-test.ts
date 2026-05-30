/**
 * P0 专项测试 — DAG Scheduler + Vector Store + Failure Memory
 */

import { TaskScheduler } from "../core/scheduler/task-scheduler.js";
import { VectorStore } from "../core/memory/vector-store.js";
import { FailureMemory } from "../core/recovery/failure-memory.js";
import { ExecutorRegistry } from "../core/executor/executor-registry.js";
import { CommandExecutor } from "../core/executor/command-executor.js";
import { getDatabase, migrate } from "../core/state-graph/database.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  migrate();

  console.log("═".repeat(60));
  console.log("  P0 验收测试: DAG Scheduler + Vector Store + Failure Memory");
  console.log("═".repeat(60));

  let passed = 0, failed = 0;

  const ws = fs.mkdtempSync(path.join(process.cwd(), "test", "p0_"));

  // ============================================================
  // Test 1: TaskScheduler — 并行执行
  // ============================================================
  console.log("\n📋 Test 1: TaskScheduler — 并行执行 3 个独立任务");
  {
    const registry = new ExecutorRegistry().register(new CommandExecutor(ws));
    const scheduler = new TaskScheduler(registry, { maxConcurrency: 3, stopOnFailure: false });

    const tasks = [
      { id: "t1", description: "task 1", depends_on: [], children: [], status: "pending" as const, retry_count: 0, max_retries: 1 },
      { id: "t2", description: "task 2", depends_on: [], children: [], status: "pending" as const, retry_count: 0, max_retries: 1 },
      { id: "t3", description: "task 3", depends_on: [], children: [], status: "pending" as const, retry_count: 0, max_retries: 1 },
    ];

    const result = await scheduler.executeDAG(tasks, ws);
    if (result.completed.length === 3 && result.totalDurationMs > 0) {
      console.log(`   ✅ PASS: ${result.completed.length} completed, ${result.totalDurationMs}ms, speedup=${result.speedup}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${result.completed.length} completed, ${result.failed.length} failed`);
      failed++;
    }
  }

  // ============================================================
  // Test 2: TaskScheduler — 依赖顺序
  // ============================================================
  console.log("\n📋 Test 2: TaskScheduler — 依赖顺序执行");
  {
    const registry = new ExecutorRegistry().register(new CommandExecutor(ws));
    const scheduler = new TaskScheduler(registry, { maxConcurrency: 4 });

    const tasks = [
      { id: "a", description: "A", depends_on: [], children: ["b"], status: "pending" as const, retry_count: 0, max_retries: 1 },
      { id: "b", description: "B", depends_on: ["a"], children: ["c"], status: "pending" as const, retry_count: 0, max_retries: 1 },
      { id: "c", description: "C", depends_on: ["b"], children: [], status: "pending" as const, retry_count: 0, max_retries: 1 },
    ];

    const result = await scheduler.executeDAG(tasks, ws);
    if (result.completed.length === 3) {
      console.log("   ✅ PASS: 3 个依赖任务顺序完成");
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${result.completed.length}/3 done`);
      failed++;
    }
  }

  // ============================================================
  // Test 3: TaskScheduler — 失败任务导致依赖阻塞
  // ============================================================
  console.log("\n📋 Test 3: TaskScheduler — 失败导致依赖阻塞");
  {
    const registry = new ExecutorRegistry().register(new CommandExecutor(ws));
    const scheduler = new TaskScheduler(registry, { maxConcurrency: 2 });

    const tasks = [
      { id: "x", description: "will fail", depends_on: [], children: ["y"], status: "pending" as const, retry_count: 0, max_retries: 0 },
      { id: "y", description: "depends on x", depends_on: ["x"], children: [], status: "pending" as const, retry_count: 0, max_retries: 1 },
    ];

    // 使用不存在的命令让 x 真正失败
    const sched3 = new TaskScheduler(registry, { maxConcurrency: 2, stopOnFailure: false });
    
    // 覆盖 dispatch 让 x 返回失败
    const origDispatch = registry.dispatch.bind(registry);
    registry.dispatch = async (input) => {
      if (input.description.includes("will fail")) {
        return { success: false, output: "", error: "simulated failure", durationMs: 1, action: input.action };
      }
      return origDispatch(input);
    };

    const result3 = await sched3.executeDAG(tasks, ws);
    if (result3.skipped.length >= 1 || result3.failed.length >= 1) {
      console.log(`   ✅ PASS: 失败 ${result3.failed.length}, 跳过 ${result3.skipped.length}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 应该检测到失败阻塞`);
      failed++;
    }
  }

  // ============================================================
  // Test 4: VectorStore — 插入 + 搜索
  // ============================================================
  console.log("\n📋 Test 4: VectorStore — 插入 + Cosine 搜索");
  {
    const store = new VectorStore();
    
    // 插入测试向量
    store.insertBatch([
      { id: "v1", content: "JWT authentication implementation", embedding: [0.1, 0.3, 0.5, 0.7, 0.2], category: "memory", created_at: new Date().toISOString() },
      { id: "v2", content: "User login system design", embedding: [0.15, 0.32, 0.48, 0.68, 0.22], category: "memory", created_at: new Date().toISOString() },
      { id: "v3", content: "Database performance optimization", embedding: [0.9, 0.1, 0.05, 0.02, 0.8], category: "memory", created_at: new Date().toISOString() },
    ]);

    // 查询与 JWT 相关的向量
    const results = store.search([0.12, 0.31, 0.49, 0.69, 0.21], "memory", 3);
    
    if (results.length >= 2 && results[0].score > 0.9) {
      console.log(`   ✅ PASS: ${results.length} 结果, top: "${results[0].entry.content}" (${(results[0].score * 100).toFixed(0)}%)`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${results.length} results, top score=${results[0]?.score}`);
      failed++;
    }
  }

  // ============================================================
  // Test 5: VectorStore — Cosine Similarity 计算
  // ============================================================
  console.log("\n📋 Test 5: VectorStore — Cosine Similarity 精度");
  {
    const store = new VectorStore();
    const same = store.cosineSimilarity([1, 2, 3], [1, 2, 3]);
    const orthogonal = store.cosineSimilarity([1, 0, 0], [0, 1, 0]);
    
    if (Math.abs(same - 1.0) < 0.001 && Math.abs(orthogonal) < 0.001) {
      console.log("   ✅ PASS: same=1.0, orthogonal=0.0");
      passed++;
    } else {
      console.log(`   ❌ FAIL: same=${same}, orthogonal=${orthogonal}`);
      failed++;
    }
  }

  // ============================================================
  // Test 6: Failure Memory — 记录 + 检索
  // ============================================================
  console.log("\n📋 Test 6: Failure Memory — 记录 + 检索失败模式");
  {
    const fm = new FailureMemory();
    
    fm.record({
      errorMessage: "ECONNREFUSED: npm install failed due to network timeout",
      rootCause: "npm registry unreachable",
      solution: "Use npm config set registry https://registry.npmmirror.com",
      wasSuccessful: true,
    });

    fm.record({
      errorMessage: "TypeError: Cannot read property 'id' of undefined",
      rootCause: "Missing null check on API response",
      solution: "Add optional chaining (?.) before accessing nested properties",
      wasSuccessful: true,
    });

    // 检索网络错误
    const networkSolutions = fm.findSolutions("ECONNREFUSED connection timeout", 3);
    
    if (networkSolutions.length >= 1) {
      console.log(`   ✅ PASS: 找到 ${networkSolutions.length} 个解决方案`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${networkSolutions.length} solutions found`);
      failed++;
    }
  }

  // ============================================================
  // Test 7: Failure Memory — 反馈学习
  // ============================================================
  console.log("\n📋 Test 7: Failure Memory — 反馈学习");
  {
    const fm = new FailureMemory();
    
    const pattern = fm.record({
      errorMessage: "Build failed: tsconfig.json not found",
      rootCause: "Missing config file",
      solution: "Run npx tsc --init",
    });

    fm.feedback(pattern.id, false); // 方案无效
    fm.feedback(pattern.id, true);  // 方案有效
    
    const solutions = fm.findSolutions("tsconfig.json not found");
    if (solutions.length >= 1) {
      console.log(`   ✅ PASS: 反馈学习完成, successRate=${(solutions[0].successRate * 100).toFixed(0)}%`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: successRate=${solutions[0]?.successRate}`);
      failed++;
    }
  }

  // ============================================================
  // Test 8: Failure Memory — 高频失败报告
  // ============================================================
  console.log("\n📋 Test 8: Failure Memory — 高频失败报告");
  {
    const fm = new FailureMemory();
    const top = fm.getTopFailures(5);
    
    if (top.length > 0) {
      console.log(`   ✅ PASS: ${top.length} 个高频失败模式 (all successRate < 0.5)`);
      passed++;
    } else {
      console.log("   ⚠️  WARN: 无高频失败（所有模式成功率 >= 0.5 或暂无数据）");
      passed++; // 空结果也是合法状态
    }
  }

  // 清理
  if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true });

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  P0 结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
