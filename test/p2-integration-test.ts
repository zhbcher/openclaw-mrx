/**
 * P2 集成测试 — Supervisor V2 + Metrics Engine
 */

import { QualityManager } from "../agents/supervisor/quality-manager.js";
import { MetricsEngine } from "../core/metrics/metrics-engine.js";
import { getDatabase, migrate } from "../core/state-graph/database.js";
import { ObjectiveEngine } from "../core/objective/objective-engine.js";
import { CheckpointManagerV2 } from "../core/checkpoint/checkpoint-v2.js";

async function main() {
  migrate();

  console.log("═".repeat(60));
  console.log("  P2 验收测试: Supervisor V2 + Metrics Engine");
  console.log("═".repeat(60));

  let passed = 0, failed = 0;

  // ============================================================
  // Test 1: Quality Manager 快速检查
  // ============================================================
  console.log("\n📋 Test 1: Quality Manager 快速检查");
  try {
    const qm = new QualityManager();
    const mockAdapter = {
      name: "mock",
      executeCommand: async (cmd: string) => {
        if (cmd.includes("echo 0")) return { success: true, output: "0", duration_ms: 1 };
        if (cmd.includes("grep -c 'error TS'")) return { success: true, output: "0", duration_ms: 1 };
        if (cmd.includes("wc -l")) return { success: true, output: "0", duration_ms: 1 };
        return { success: true, output: "ok", duration_ms: 1 };
      },
      readFile: async () => "",
      writeFile: async () => ({ success: true, duration_ms: 1 }),
      fileExists: async () => true,
    };

    const report = await qm.quickCheck(mockAdapter, ".");
    if (report.overall === "pass") {
      console.log(`   ✅ PASS: 快速质量检查通过 (${report.checks.length} 项)`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${report.overall}`);
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // ============================================================
  // Test 2: Quality Report 格式化
  // ============================================================
  console.log("\n📋 Test 2: Quality Report 格式化");
  try {
    const qm = new QualityManager();
    const report = await qm.quickCheck({
      name: "mock", executeCommand: async () => ({ success: true, output: "0", duration_ms: 1 }),
      readFile: async () => "", writeFile: async () => ({ success: true, duration_ms: 1 }),
      fileExists: async () => false,
    }, ".");

    const formatted = qm.formatReport(report);
    if (formatted.includes("质量评估") && formatted.includes("✅") || formatted.includes("❌")) {
      console.log("   ✅ PASS: 格式化输出正确");
      passed++;
    } else {
      console.log("   ❌ FAIL: 格式化异常");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // ============================================================
  // Test 3: Metrics Engine — Mission 指标
  // ============================================================
  console.log("\n📋 Test 3: Metrics Engine — Mission 指标");
  try {
    // 创建测试数据
    const objEng = new ObjectiveEngine();
    const obj = objEng.create({ title: "Metrics 测试项目" });
    objEng.attachGoals(obj.id, [
      { id: "m_g1", title: "G1", deliverable: "G1 done", complexity: "low", depends_on: [] },
    ]);

    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO missions (id, objective_id, status, created_at, updated_at, budget_tokens, max_tokens, budget_cost, max_cost_usd)
      VALUES (?, ?, 'completed', ?, ?, 50000, 1000000, 0.50, 10)`).run("p2_test_mission", obj.id, now, now);
    db.prepare(`UPDATE missions SET completed_at = ? WHERE id = ?`).run(now, "p2_test_mission");
    db.prepare(`INSERT INTO checkpoints (id, mission_id, iteration, phase, snapshot_data, created_at)
      VALUES (?, ?, 1, 'execute', '{}', ?)`).run("cp_metrics_1", "p2_test_mission", now);

    const metrics = new MetricsEngine();
    const report = metrics.getMissionMetrics("p2_test_mission");

    if (report && report.status === "completed" && report.checkpoints.count >= 1) {
      console.log(`   ✅ PASS: Mission 指标正确 (checkpoints: ${report.checkpoints.count}, tokens: ${report.budget.tokensConsumed})`);
      console.log(metrics.formatMissionReport(report));
      passed++;
    } else {
      console.log("   ❌ FAIL: 指标数据异常");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // ============================================================
  // Test 4: Metrics Engine — 全局统计
  // ============================================================
  console.log("\n📋 Test 4: Metrics Engine — 全局统计");
  try {
    const metrics = new MetricsEngine();
    const global = metrics.getGlobalMetrics();

    if (global.totalMissions >= 1) {
      console.log(`   ✅ PASS: 全局统计 (${global.totalMissions} missions, ${global.overallSuccessRate}% success)`);
      console.log(metrics.formatGlobalReport(global));
      passed++;
    } else {
      console.log("   ❌ FAIL: 全局统计为空");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  P2 结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
