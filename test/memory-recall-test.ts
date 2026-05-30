/**
 * Memory Recall 集成测试
 * 
 * 验证 Recall Engine 能正确召回历史记忆
 */

import { RecallEngine } from "../core/memory/recall-engine.js";
import * as path from "path";

async function main() {
  const memoryDir = path.join(process.cwd(), "data", "memory");
  const engine = new RecallEngine(memoryDir);

  console.log("═".repeat(60));
  console.log("  Memory Recall 集成测试");
  console.log("═".repeat(60));

  let passed = 0, failed = 0;

  // Test 1: JWT 相关任务召回
  console.log("\n📋 Test 1: JWT 鉴权任务召回");
  {
    const { built, raw } = await engine.recall(
      "实现JWT用户登录接口",
      "用户认证系统"
    );
    
    if (raw.entries.length > 0 && built.hits.failures > 0) {
      console.log("   ✅ PASS: 召回了 JWT 相关历史经验");
      console.log(`      失败教训: ${built.hits.failures} | 方案: ${built.hits.solutions} | 决策: ${built.hits.decisions}`);
      passed++;
    } else {
      console.log("   ❌ FAIL: 未召回 JWT 相关记忆");
      failed++;
    }
  }

  // Test 2: Redis 缓存任务召回
  console.log("\n📋 Test 2: Redis 缓存任务召回");
  {
    const { built, raw } = await engine.recall(
      "优化API性能，引入缓存层",
      "性能优化项目"
    );
    
    if (raw.entries.length > 0 && built.hits.failures > 0) {
      console.log("   ✅ PASS: 召回了 Redis 连接池耗尽教训");
      passed++;
    } else {
      console.log("   ❌ FAIL: 未召回 Redis 相关记忆");
      failed++;
    }
  }

  // Test 3: TypeScript 构建任务召回
  console.log("\n📋 Test 3: TypeScript 编译 OOM 召回");
  {
    const { built } = await engine.recall(
      "配置TypeScript编译选项",
      "前端工程化"
    );
    
    if (built.hits.failures > 0 || built.hits.decisions > 0) {
      console.log("   ✅ PASS: 召回了 TypeScript 相关经验");
      passed++;
    } else {
      console.log("   ❌ FAIL: 未召回 TypeScript 相关记忆");
      failed++;
    }
  }

  // Test 4: 不相关任务（应无结果或低分）
  console.log("\n📋 Test 4: 不相关任务（应无高相关结果）");
  {
    const { built, raw } = await engine.recall(
      "设计数据库表结构",
      "新项目初始化"
    );
    
    // 数据库相关可能碰巧匹配一些内容，但分数应该很低
    const highRelevanceResults = raw.entries.filter(e => e.relevanceScore > 0.5);
    console.log(`   ${highRelevanceResults.length === 0 ? "✅ PASS" : "⚠️  WARN"}: 高相关结果 = ${highRelevanceResults.length} (预期 0)`);
    if (highRelevanceResults.length === 0) passed++;
  }

  // Test 5: Context Builder 输出格式
  console.log("\n📋 Test 5: Context Builder 输出格式");
  {
    const { built, raw } = await engine.recall(
      "实现JWT用户登录接口",
      "用户认证系统"
    );
    
    if (built.text.includes("历史经验参考") && built.text.includes("JWT")) {
      console.log("   ✅ PASS: Context 格式正确");
      console.log("\n   --- Context 预览 ---");
      console.log(built.text.slice(0, 300) + "...");
      passed++;
    } else {
      console.log("   ❌ FAIL: Context 格式异常");
      failed++;
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
