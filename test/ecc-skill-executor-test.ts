/**
 * ECC Skill Executor 集成测试
 * 
 * 验证 ECCSkillExecutor 能够正确发现、解析和执行 ECC 技能。
 */

import { ECCSkillExecutor } from "../core/executor/ecc-skill-executor.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("═".repeat(70));
  console.log("  ECC Skill Executor 集成测试");
  console.log("═".repeat(70));

  let passed = 0, failed = 0;

  const workspaceDir = path.join(process.cwd(), "test", "ecc_workspace");
  if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  // ============================================================
  // Test 1: 初始化 ECCSkillExecutor
  // ============================================================
  console.log("\n📋 Test 1: 初始化 ECCSkillExecutor");
  const eccSkillsDir = path.join(process.cwd(), "ecc-skills");
  
  if (!fs.existsSync(eccSkillsDir)) {
    console.log(`   ⚠️  ECC 技能目录不存在: ${eccSkillsDir}`);
    console.log(`   跳过此测试`);
  } else {
    const executor = new ECCSkillExecutor(eccSkillsDir);
    await executor.initialize();
    
    const skills = executor.listSkills();
    if (skills.length > 0) {
      console.log(`   ✅ PASS: 成功加载 ${skills.length} 个 ECC 技能`);
      console.log(`   首 5 个技能:`);
      skills.slice(0, 5).forEach(s => {
        console.log(`     - ${s.id}: ${s.name}`);
      });
      passed++;
    } else {
      console.log(`   ❌ FAIL: 未加载任何技能`);
      failed++;
    }
  }

  // ============================================================
  // Test 2: 检查 canHandle 方法
  // ============================================================
  console.log("\n📋 Test 2: 检查 canHandle 方法");
  const executor = new ECCSkillExecutor(eccSkillsDir);
  {
    const canHandleECC = executor.canHandle({ type: "ecc_skill" as any, target: "test-skill" });
    const cannotHandleShell = executor.canHandle({ type: "shell", target: "echo test" });
    
    if (canHandleECC && !cannotHandleShell) {
      console.log(`   ✅ PASS: canHandle 方法正确识别 ecc_skill 类型`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: canHandle 方法识别错误`);
      failed++;
    }
  }

  // ============================================================
  // Test 3: 执行不存在的技能
  // ============================================================
  console.log("\n📋 Test 3: 执行不存在的技能（错误处理）");
  await executor.initialize();
  {
    const result = await executor.execute({
      description: "执行不存在的技能",
      workingDir: workspaceDir,
      action: { type: "ecc_skill" as any, target: "nonexistent-skill" },
    });
    
    if (!result.success && result.error?.includes("不存在")) {
      console.log(`   ✅ PASS: 正确处理不存在的技能错误`);
      console.log(`   错误信息: ${result.error.slice(0, 100)}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 未正确处理错误`);
      failed++;
    }
  }

  // ============================================================
  // Test 4: 列出所有技能
  // ============================================================
  console.log("\n📋 Test 4: 列出所有可用的 ECC 技能");
  {
    const skills = executor.listSkills();
    console.log(`   ✅ PASS: 共发现 ${skills.length} 个 ECC 技能`);
    
    // 显示一些技能信息
    if (skills.length > 0) {
      console.log(`   技能示例（前 10 个）:`);
      skills.slice(0, 10).forEach((s, i) => {
        const desc = s.description.length > 50 
          ? s.description.slice(0, 50) + "..." 
          : s.description;
        console.log(`     ${i + 1}. ${s.id}`);
        console.log(`        名称: ${s.name}`);
        console.log(`        描述: ${desc}`);
      });
    }
    passed++;
  }

  // ============================================================
  // Test 5: 获取特定技能的详细信息
  // ============================================================
  console.log("\n📋 Test 5: 获取特定技能的详细信息");
  {
    const skills = executor.listSkills();
    if (skills.length > 0) {
      const firstSkill = skills[0];
      const skillInfo = executor.getSkillInfo(firstSkill.id);
      
      if (skillInfo && skillInfo.id === firstSkill.id) {
        console.log(`   ✅ PASS: 成功获取技能 '${firstSkill.id}' 的详细信息`);
        console.log(`   技能目录: ${skillInfo.skillDir}`);
        console.log(`   可用脚本: ${skillInfo.scripts.join(", ") || "无"}`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: 无法获取技能详细信息`);
        failed++;
      }
    } else {
      console.log(`   ⚠️  跳过: 没有可用的技能`);
    }
  }

  // ============================================================
  // 测试总结
  // ============================================================
  console.log("\n" + "═".repeat(70));
  console.log(`  测试总结: ${passed} 通过, ${failed} 失败`);
  console.log("═".repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("❌ 测试执行失败:", err);
  process.exit(1);
});
