/**
 * MRX + ECC 深度融合集成测试
 * 
 * 验证 ECC 规则加载、上下文增强、Agent 适配和规则验证功能。
 */

import { 
  getECCRuleLoader, 
  ECCContextBuilder, 
  ECCAgentAdapter, 
  ECCVerifier 
} from "../core/ecc/index.js";
import * as path from "path";

async function main() {
  console.log("═".repeat(70));
  console.log("  MRX + ECC 深度融合集成测试");
  console.log("═".repeat(70));

  const eccAssetsDir = path.join(process.cwd(), "ecc-assets");
  const loader = getECCRuleLoader(eccAssetsDir);
  await loader.initialize();

  let passed = 0, failed = 0;

  // ============================================================
  // Test 1: 规则检索测试
  // ============================================================
  console.log("\n📋 Test 1: 规则检索测试");
  {
    const tsRules = loader.getRulesByKeywords(["typescript", "security"]);
    if (tsRules.length > 0) {
      console.log(`   ✅ PASS: 成功检索到 ${tsRules.length} 条 TypeScript 安全规则`);
      console.log(`   首条规则: ${tsRules[0].title} (${tsRules[0].id})`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 未能检索到 TypeScript 安全规则`);
      failed++;
    }
  }

  // ============================================================
  // Test 2: Agent 匹配测试
  // ============================================================
  console.log("\n📋 Test 2: Agent 匹配测试");
  {
    const adapter = new ECCAgentAdapter(loader);
    const agent = adapter.selectAgent(["typescript", "reviewer"]);
    
    if (agent && (agent.id === "typescript-reviewer" || agent.id === "code-reviewer")) {
      console.log(`   ✅ PASS: 成功匹配到 TypeScript Reviewer 代理`);
      console.log(`   代理描述: ${agent.description.slice(0, 100)}...`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 未能匹配到正确的代理`);
      failed++;
    }
  }

  // ============================================================
  // Test 3: 上下文增强测试
  // ============================================================
  console.log("\n📋 Test 3: 上下文增强测试");
  {
    const builder = new ECCContextBuilder(eccAssetsDir);
    await builder.initialize();
    
    const baseContext = "这是基础的历史记忆内容。";
    const task = "Review the TypeScript code for potential security vulnerabilities.";
    const keywords = ["typescript", "security", "review"];
    
    const enriched = await builder.buildEnhancedContext(baseContext, task, keywords);
    
    if (enriched.text.includes("ECC 核心规则与标准")) {
      console.log(`   ✅ PASS: 上下文已成功增强，包含 ECC 规则`);
      console.log(`   增强摘要: ${enriched.summary}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 上下文增强失败`);
      failed++;
    }
  }

  // ============================================================
  // Test 4: Agent 系统提示词生成测试
  // ============================================================
  console.log("\n📋 Test 4: Agent 系统提示词生成测试");
  {
    const adapter = new ECCAgentAdapter(loader);
    const agent = adapter.selectAgent(["typescript", "reviewer"]);
    
    if (agent) {
      const systemPrompt = adapter.generateSystemPrompt(agent);
      if (systemPrompt.length > 100) {
        console.log(`   ✅ PASS: 成功生成包含安全基线和优先级的系统提示词`);
        console.log(`   提示词长度: ${systemPrompt.length} 字符`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: 系统提示词生成不完整`);
        failed++;
      }
    }
  }

  // ============================================================
  // Test 5: 规则验证测试
  // ============================================================
  console.log("\n📋 Test 5: 规则验证测试");
  {
    const verifier = new ECCVerifier(loader);
    const badCode = `
      const password = "hardcoded_secret";
      eval("console.log(password)");
      document.getElementById("output").innerHTML = userControlledInput;
    `;
    
    const result = await verifier.verify(badCode, "typescript", "security");
    
    if (!result.passed && result.violations.length >= 2) {
      console.log(`   ✅ PASS: 成功检测到 ${result.violations.length} 项规则违规`);
      console.log(`   违规项: ${result.violations.join(", ")}`);
      console.log(`   严重程度: ${result.severity}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 未能正确检测到违规`);
      failed++;
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
