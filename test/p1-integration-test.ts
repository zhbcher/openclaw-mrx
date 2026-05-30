/**
 * P1 集成测试 — Checkpoint Rollback + Recovery V2 + Verifier Chain
 */

import { CheckpointManagerV2 } from "../core/checkpoint/checkpoint-v2.js";
import { RecoveryEngineV2 } from "../core/recovery/recovery-engine-v2.js";
import { VerifierChain, SyntaxVerifier, BuildVerifier, TestVerifier, GoalVerifier } from "../core/validator/verifier-chain.js";
import { ObjectiveEngine } from "../core/objective/objective-engine.js";
import { GoalEngine } from "../core/goal/goal-engine.js";
import { getDatabase, migrate } from "../core/state-graph/database.js";

async function main() {
  migrate();

  console.log("═".repeat(60));
  console.log("  P1 验收测试: Checkpoint + Recovery V2 + Verifier Chain");
  console.log("═".repeat(60));

  let passed = 0;
  let failed = 0;

  // ============================================================
  // Test 1: Checkpoint 创建 + 回滚
  // ============================================================
  console.log("\n📋 Test 1: Checkpoint 创建 + 回滚");

  const cpMgr = new CheckpointManagerV2();
  const objectiveEngine = new ObjectiveEngine();
  const goalEngine = new GoalEngine();

  // 创建 Objective + Goals（模拟中间状态）
  const obj = objectiveEngine.create({
    title: "Checkpoint 测试项目",
    description: "验证 checkpoint 创建和回滚能力",
  });

  objectiveEngine.attachGoals(obj.id, [
    { id: "cp_goal_01", title: "任务 A", deliverable: "A 完成", complexity: "low", depends_on: [] },
    { id: "cp_goal_02", title: "任务 B", deliverable: "B 完成", complexity: "medium", depends_on: ["cp_goal_01"] },
  ]);

  objectiveEngine.start(obj.id);
  goalEngine.start("cp_goal_01");
  goalEngine.onGoalCompleted("cp_goal_01", obj.id);

  // 创建快照
  const cp1 = cpMgr.create("test_mission", obj.id, 5, "execute", "Goal A 完成，Goal B 进行中");

  // 修改状态（模拟后续操作）
  goalEngine.start("cp_goal_02");

  // 创建另一个快照
  const cp2 = cpMgr.create("test_mission", obj.id, 10, "execute", "Goal B 开始执行");

  // 再修改状态
  goalEngine.fail("cp_goal_02", "模拟失败");

  // 回滚到 cp1
  const rollbackResult = await cpMgr.rollback(cp1.id);

  if (rollbackResult.success && rollbackResult.restored.goals === 2) {
    console.log(`   ✅ PASS: 回滚成功，恢复 ${rollbackResult.restored.goals} Goals (未创建 Task，0 Tasks 正常)`);

    // 验证状态是否真正恢复
    const recovered = objectiveEngine.getFull(obj.id);
    const goal1 = recovered?.goals.find(g => g.id === "cp_goal_01");
    const goal2 = recovered?.goals.find(g => g.id === "cp_goal_02");

    if (goal1?.status === "completed" && goal2?.status === "ready") {
      console.log("   ✅ PASS: 状态验证：Goal A = completed, Goal B = ready（回滚正确，A完成后B解锁）");
      passed += 2;
    } else {
      console.log(`   ❌ FAIL: 状态不正确: Goal A=${goal1?.status}, Goal B=${goal2?.status}`);
      failed += 2;
    }
  } else {
    console.log("   ❌ FAIL: 回滚失败");
    failed += 2;
  }

  // ============================================================
  // Test 2: Checkpoint Diff
  // ============================================================
  console.log("\n📋 Test 2: Checkpoint Diff");
  const diff = cpMgr.diff(cp1.id, cp2.id);
  if (diff.goalChanges.length > 0) {
    console.log(`   ✅ PASS: 检测到 ${diff.goalChanges.length} 个 Goal 变更`);
    for (const gc of diff.goalChanges) {
      console.log(`     ${gc.title}: ${gc.from} → ${gc.to}`);
    }
    passed++;
  } else {
    console.log("   ❌ FAIL: 未检测到变更");
    failed++;
  }

  // ============================================================
  // Test 3: Recovery V2 — 六分支决策
  // ============================================================
  console.log("\n📋 Test 3: Recovery V2 — 六分支决策");
  const recovery = new RecoveryEngineV2();

  const testCases = [
    {
      name: "RETRY",
      input: { validationPassed: false, retryCount: 1, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "low" as const, selfHealingEnabled: true, hasCheckpoint: false, isCriticalPath: true,
        rootCause: "临时网络错误" },
      expected: "retry",
    },
    {
      name: "SKIP",
      input: { validationPassed: false, retryCount: 3, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "medium" as const, selfHealingEnabled: true, hasCheckpoint: false, isCriticalPath: false,
        rootCause: "非关键路径失败" },
      expected: "skip",
    },
    {
      name: "ROLLBACK",
      input: { validationPassed: false, retryCount: 3, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "medium" as const, selfHealingEnabled: true, hasCheckpoint: true, isCriticalPath: true,
        rootCause: "关键路径失败" },
      expected: "rollback",
    },
    {
      name: "ALTERNATIVE",
      input: { validationPassed: false, retryCount: 3, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "medium" as const, selfHealingEnabled: true, hasCheckpoint: false, isCriticalPath: true,
        rootCause: "当前方案不可行" },
      expected: "alternative",
    },
    {
      name: "ESCALATE (critical)",
      input: { validationPassed: false, retryCount: 0, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "critical" as const, selfHealingEnabled: true, hasCheckpoint: true, isCriticalPath: true,
        rootCause: "数据损坏" },
      expected: "escalate",
    },
    {
      name: "CONTINUE",
      input: { validationPassed: true, retryCount: 0, maxRetries: 3, iteration: 5, maxIterations: 50,
        severity: "low" as const, selfHealingEnabled: true, hasCheckpoint: false, isCriticalPath: true,
        rootCause: undefined },
      expected: "continue",
    },
  ];

  let recoveryPassed = 0;
  for (const tc of testCases) {
    const decision = recovery.decide(tc.input);
    if (decision.verdict === tc.expected) {
      recoveryPassed++;
    } else {
      console.log(`     ❌ ${tc.name}: 预期 ${tc.expected}，实际 ${decision.verdict}`);
    }
  }

  if (recoveryPassed === testCases.length) {
    console.log(`   ✅ PASS: ${recoveryPassed}/${testCases.length} 个决策分支全部正确`);
    passed++;
  } else {
    console.log(`   ❌ FAIL: ${recoveryPassed}/${testCases.length} 正确`);
    failed++;
  }

  // ============================================================
  // Test 4: Verifier Chain 结构
  // ============================================================
  console.log("\n📋 Test 4: Verifier Chain 结构");
  const chain = new VerifierChain();
  const desc = chain.describe();

  if (desc.includes("syntax") && desc.includes("build") && desc.includes("test")) {
    console.log("   ✅ PASS: 三层验证链结构正确");
    console.log(desc);
    passed++;
  } else {
    console.log("   ❌ FAIL: 验证链结构异常");
    failed++;
  }

  // ============================================================
  // Test 5: Goal Verifier 自定义验证
  // ============================================================
  console.log("\n📋 Test 5: Goal Verifier 自定义验证配置");
  const goalVerifier = new GoalVerifier({
    commands: ["echo 'check passed'"],
    expectedOutput: ["check passed"],
    expectedFiles: ["package.json"],
  });

  // 模拟 adapter
  const mockAdapter = {
    name: "mock",
    executeCommand: async (cmd: string, _cwd: string) => {
      if (cmd.includes("grep")) return { success: true, output: "found: package.json", duration_ms: 1 };
      if (cmd.includes("ls")) return { success: true, output: "package.json", duration_ms: 1 };
      return { success: true, output: "check passed", duration_ms: 1 };
    },
    readFile: async () => "",
    writeFile: async () => ({ success: true, duration_ms: 1 }),
    fileExists: async () => true,
  };

  const result = await goalVerifier.run(mockAdapter, ".");
  if (result.passed) {
    console.log(`   ✅ PASS: Goal Verifier 自定义验证通过`);
    passed++;
  } else {
    console.log(`   ❌ FAIL: ${result.error}`);
    failed++;
  }

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  P1 结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
