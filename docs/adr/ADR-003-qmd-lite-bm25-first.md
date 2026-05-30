# ADR-003: QMD Lite（BM25-only）优先于完整向量检索

**状态**：已采纳  
**日期**：2026-05-30  
**决策者**：旺财 + 龙虾（外部架构审计）

---

## 背景

MRX 的 Memory Compiler 目前"只写不读"——执行记录被编译为 Markdown 文件后躺在磁盘里，没有任何召回路径。Memory Recall 需要检索能力。

OpenClaw 的 QMD 系统支持 BM25 关键词检索 + 向量语义检索双重模式。但当前 QMD 配置为 `searchMode: "search"`（纯 BM25），向量检索因 node-llama-cpp 死锁完全不可用。

## 问题

要不要等向量检索恢复后再做 Memory Recall？

## 方案对比

### 方案 A：等向量检索恢复，直接做完整的 QMD Adapter

**优点**：一步到位，语义检索精度最高  
**缺点**：阻塞 Memory Recall（当前最大短板），等待时间不可控

### 方案 B：QMD Lite（采纳）——先用 BM25 跑通闭环

```
Memory Compiler → BM25 索引 → Memory Recall（关键词召回）
```

**优点**：
- 不阻塞主流程，Memory Recall 闭环今跑通
- BM25 对工程类内容（代码、命令、日志）效果不错
- 向量恢复后渐进升级为 Hybrid Search

**缺点**：
- 语义检索精度不足（"JWT 鉴权" 搜不到 "token 认证"）
- 未来需要做 QMD Adapter Full 升级

### 方案 C：引入外部向量服务（Pinecone/Qdrant Cloud）

**优点**：完全免运维  
**缺点**：违反本地优先原则，引入外部依赖和费用

## 决策

采用 **QMD Lite**：基于现有 BM25-only QMD，通过关键词提取 + BM25 召回 + 简单 rerank 跑通 Memory Recall 闭环。向量检索恢复后升级为 QMD Adapter Full（Hybrid Search）。

## 影响

- Memory Recall Engine 依赖 `memory_search` tool（已配置 BM25-only）
- Recall 精度在 Phase 1 受限于关键词匹配，需通过 `keyword-extractor.ts` 做同义词扩展
- 核心数据结构（MemoryEntry）不变，升级 QMD Adapter Full 时无需迁移
