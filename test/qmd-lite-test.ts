/**
 * QMD Lite 集成测试
 * 
 * 验证完整链路：
 *   Memory Compiler → QMD Ingest → Recall Engine（双源检索）
 */

import { MemoryCompiler, type CompiledMemory } from "../core/memory/memory-compiler.js";
import { QmdLiteIngest } from "../core/memory/qmd-lite-ingest.js";
import { QmdLiteClient } from "../core/memory/qmd-lite-client.js";
import { RecallEngine } from "../core/memory/recall-engine.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("═".repeat(60));
  console.log("  QMD Lite 集成测试");
  console.log("═".repeat(60));

  let passed = 0;
  let failed = 0;

  const baseDir = path.join(process.cwd(), "memory", "mrx");
  const memoryDir = path.join(process.cwd(), "data", "memory");

  // 准备测试数据
  const testMissionId = "qmd_test_mission";
  const testCompiled: CompiledMemory = {
    decisions: [
      {
        id: "mem_001", type: "decision", mission_id: testMissionId,
        timestamp: new Date().toISOString(), title: "选择 SQLite 作为本地数据库",
        content: "评估了 SQLite vs LevelDB。SQLite 在查询能力、工具生态上明显优于 LevelDB。WAL 模式解决了并发读写问题。",
        tags: ["sqlite", "database", "architecture"], confidence: 0.9,
      },
    ],
    failures: [
      {
        id: "mem_002", type: "failure", mission_id: testMissionId,
        timestamp: new Date().toISOString(), title: "SQLite WAL 文件过大导致磁盘满",
        content: "生产环境 WAL 文件增长到 2GB。根因：checkpoint 间隔过长。修复：PRAGMA wal_autocheckpoint=1000。",
        tags: ["sqlite", "wal", "disk-full"], confidence: 0.95,
      },
      {
        id: "mem_003", type: "failure", mission_id: testMissionId,
        timestamp: new Date().toISOString(), title: "Node.js 事件循环阻塞",
        content: "同步 fs.writeFileSync 阻塞事件循环，导致 API 超时。迁移到异步 IO 后解决。",
        tags: ["node", "event-loop", "io"], confidence: 0.88,
      },
    ],
    solutions: [
      {
        id: "mem_004", type: "solution", mission_id: testMissionId,
        timestamp: new Date().toISOString(), title: "SQLite 连接池实现",
        content: "使用单例模式管理 SQLite 连接，设置 busy_timeout=5000 避免锁等待。",
        tags: ["sqlite", "connection-pool", "performance"], confidence: 0.85,
      },
    ],
    patterns: [],
    knowledge: [],
  };

  // Test 1: Ingest → 写入 QMD 索引路径
  console.log("\n📋 Test 1: QMD Ingest — 写入索引路径");
  try {
    const ingest = new QmdLiteIngest(baseDir);
    const result = ingest.ingest(testMissionId, testCompiled);

    if (result.filesWritten >= 3 && fs.existsSync(path.join(baseDir, testMissionId))) {
      console.log(`   ✅ PASS: 写入 ${result.filesWritten} 个文件, ${result.entriesCount} 条记忆`);
      console.log(`      路径: ${result.path}`);
      passed++;
    } else {
      console.log("   ❌ FAIL: 文件写入不完整");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // Test 2: QMD Client 搜索
  console.log("\n📋 Test 2: QMD Client — BM25 搜索");
  try {
    const client = new QmdLiteClient(baseDir);
    const results = client.search(["sqlite", "database"], { maxResults: 5 });

    if (results.length >= 3) {
      console.log(`   ✅ PASS: 找到 ${results.length} 条结果`);
      for (const r of results.slice(0, 3)) {
        console.log(`     [${r.entry.type}] ${r.entry.title} (${(r.score * 100).toFixed(0)}%)`);
      }
      passed++;
    } else {
      console.log(`   ❌ FAIL: 预期 ≥ 3 条，实际 ${results.length} 条`);
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // Test 3: Recall Engine 双源检索（本地 + QMD）
  console.log("\n📋 Test 3: Recall Engine — 双源检索");
  try {
    const engine = new RecallEngine(memoryDir, baseDir);
    const { built, raw } = await engine.recall(
      "排查 SQLite 数据库性能问题",
      "数据库优化"
    );

    if (raw.entries.length >= 2 && built.hits.failures > 0) {
      console.log(`   ✅ PASS: 双源检索命中 ${raw.entries.length} 条`);
      console.log(`      [本地+QMD] 失败:${built.hits.failures} 方案:${built.hits.solutions} 决策:${built.hits.decisions}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: 检索结果不足 (${raw.entries.length} 条)`);
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // Test 4: QMD 统计
  console.log("\n📋 Test 4: QMD 索引统计");
  try {
    const client = new QmdLiteClient(baseDir);
    const stats = client.getStats();
    if (stats.totalFiles > 0) {
      console.log(`   ✅ PASS: ${stats.totalFiles} 文件, 按类型: ${JSON.stringify(stats.byType)}`);
      passed++;
    } else {
      console.log("   ❌ FAIL: 索引为空");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  // Test 5: 增量追加
  console.log("\n📋 Test 5: 增量追加记忆");
  try {
    const ingest = new QmdLiteIngest(baseDir);
    ingest.append(testMissionId, {
      id: "mem_005", type: "knowledge", mission_id: testMissionId,
      timestamp: new Date().toISOString(), title: "SQLite 索引优化技巧",
      content: "对于频繁查询的列，创建复合索引可显著提升性能。使用 EXPLAIN QUERY PLAN 分析查询计划。",
      tags: ["sqlite", "index", "optimization"], confidence: 0.8,
    });

    // 验证追加内容可检索
    const client = new QmdLiteClient(baseDir);
    const results = client.search(["索引", "优化"], { maxResults: 3 });
    
    if (results.some(r => r.entry.title.includes("索引优化"))) {
      console.log("   ✅ PASS: 增量追加后成功检索");
      passed++;
    } else {
      console.log("   ❌ FAIL: 增量追加后检索不到");
      failed++;
    }
  } catch (err) {
    console.log("   ❌ FAIL:", (err as Error).message);
    failed++;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  结果: ${passed} ✅ / ${failed} ❌`);
  console.log(`${"═".repeat(60)}`);
}

main().catch(console.error);
