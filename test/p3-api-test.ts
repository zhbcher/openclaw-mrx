/**
 * P3 集成测试 — Runtime API
 * 
 * 启动 API 服务器，通过 HTTP 请求验证全部端点。
 */

import { ApiServer } from "../api/server.js";
import { registerAllRoutes } from "../api/routes.js";
import { getDatabase, migrate, closeDatabase } from "../core/state-graph/database.js";

async function main() {
  migrate();

  console.log("═".repeat(60));
  console.log("  P3 验收测试: Runtime API");
  console.log("═".repeat(60));

  let passed = 0, failed = 0;

  // 启动服务器
  const server = new ApiServer();
  registerAllRoutes(server);
  await server.start(3621);

  const BASE = "http://localhost:3621/api/v1";

  try {
    // ============================================================
    // Test 1: POST /objectives
    // ============================================================
    console.log("\n📋 Test 1: POST /objectives");
    const objRes = await fetch(`${BASE}/objectives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "API 测试项目", priority: "high" }),
    });
    const obj = await objRes.json() as any;

    if (objRes.status === 201 && obj.id && obj.title === "API 测试项目") {
      console.log(`   ✅ PASS: 创建 Objective: ${obj.id}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${objRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 2: GET /objectives
    // ============================================================
    console.log("\n📋 Test 2: GET /objectives");
    const listRes = await fetch(`${BASE}/objectives`);
    const list = await listRes.json() as any[];

    if (listRes.status === 200 && list.length >= 1) {
      console.log(`   ✅ PASS: ${list.length} objectives`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${listRes.status}, count=${list.length}`);
      failed++;
    }

    // ============================================================
    // Test 3: GET /objectives/:id
    // ============================================================
    console.log("\n📋 Test 3: GET /objectives/:id");
    const getRes = await fetch(`${BASE}/objectives/${obj.id}`);
    const getObj = await getRes.json() as any;

    if (getRes.status === 200 && getObj.title === "API 测试项目") {
      console.log(`   ✅ PASS: 获取详情成功`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${getRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 4: POST /objectives/:id/goals
    // ============================================================
    console.log("\n📋 Test 4: POST /objectives/:id/goals");
    const goalRes = await fetch(`${BASE}/objectives/${obj.id}/goals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "API Goal",
        deliverable: "API goal done",
        estimated_complexity: "medium",
      }),
    });
    const goal = await goalRes.json() as any;

    if (goalRes.status === 201 && goal.title === "API Goal") {
      console.log(`   ✅ PASS: 创建 Goal: ${goal.id}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${goalRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 5: GET /objectives/:id/goals
    // ============================================================
    console.log("\n📋 Test 5: GET /objectives/:id/goals");
    const goalsRes = await fetch(`${BASE}/objectives/${obj.id}/goals`);
    const goals = await goalsRes.json() as any[];

    if (goalsRes.status === 200 && goals.length >= 1) {
      console.log(`   ✅ PASS: ${goals.length} goals`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${goalsRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 6: PATCH /goals/:id
    // ============================================================
    console.log("\n📋 Test 6: PATCH /goals/:id");
    const patchRes = await fetch(`${BASE}/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const patched = await patchRes.json() as any;

    if (patchRes.status === 200 && patched.status === "completed") {
      console.log(`   ✅ PASS: Goal 状态更新为 completed`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${patchRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 7: GET /objectives/:id/progress
    // ============================================================
    console.log("\n📋 Test 7: GET /objectives/:id/progress");
    const progRes = await fetch(`${BASE}/objectives/${obj.id}/progress`);
    const prog = await progRes.json() as any;

    if (progRes.status === 200 && prog.overall !== undefined) {
      console.log(`   ✅ PASS: progress = ${(prog.overall * 100).toFixed(0)}%`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${progRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 8: POST /missions
    // ============================================================
    console.log("\n📋 Test 8: POST /missions");
    const missRes = await fetch(`${BASE}/missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective_id: obj.id }),
    });
    const mission = await missRes.json() as any;

    if (missRes.status === 201 && mission.id) {
      console.log(`   ✅ PASS: 创建 Mission: ${mission.id}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${missRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 9: GET /missions
    // ============================================================
    console.log("\n📋 Test 9: GET /missions");
    const missListRes = await fetch(`${BASE}/missions`);
    const missions = await missListRes.json() as any[];

    if (missListRes.status === 200 && missions.length >= 1) {
      console.log(`   ✅ PASS: ${missions.length} missions`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${missListRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 10: GET /reports/global
    // ============================================================
    console.log("\n📋 Test 10: GET /reports/global");
    const reportRes = await fetch(`${BASE}/reports/global`);
    const report = await reportRes.json() as any;

    if (reportRes.status === 200 && report.totalObjectives >= 1) {
      console.log(`   ✅ PASS: global report — ${report.totalObjectives} objectives, ${report.totalMissions} missions`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${reportRes.status}`);
      failed++;
    }

    // ============================================================
    // Test 11: 404 处理
    // ============================================================
    console.log("\n📋 Test 11: 404 处理");
    const notFound = await fetch(`${BASE}/objectives/nonexistent`);
    if (notFound.status === 404) {
      console.log("   ✅ PASS: 404 正确返回");
      passed++;
    } else {
      console.log(`   ❌ FAIL: status=${notFound.status}`);
      failed++;
    }

    // ============================================================
    // Test 12: DELETE /objectives/:id
    // ============================================================
    console.log("\n📋 Test 12: DELETE /objectives/:id");
    const delRes = await fetch(`${BASE}/objectives/${obj.id}`, { method: "DELETE" });
    if (delRes.status === 200) {
      // 验证删除
      const check = await fetch(`${BASE}/objectives/${obj.id}`);
      if (check.status === 404) {
        console.log("   ✅ PASS: 删除 + 验证成功");
        passed++;
      } else {
        console.log("   ❌ FAIL: 删除后仍可访问");
        failed++;
      }
    } else {
      console.log(`   ❌ FAIL: status=${delRes.status}`);
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FATAL:", (err as Error).message);
    failed = 12;
  }

  await server.stop();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  P3 结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);

  closeDatabase();
}

main().catch(console.error);
