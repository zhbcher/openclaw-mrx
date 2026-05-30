# MRX — OpenClaw 任务运行时

> **自主智能体运行时。** 不是技能，不是脚本，是一个长期运行的任务执行引擎。
>
> 15 个阶段。65 个文件。~12,500 行代码。CI: ![CI](https://github.com/zhbcher/openclaw-mrx/actions/workflows/ci.yml/badge.svg) 45/45 项测试通过。
>
> 📖 [English Documentation](README.md)

MRX 将 AI 智能体从"一次性提示响应器"转变为**持久化自主执行器**，能够跨小时甚至跨天进行任务规划、执行、验证、恢复、记忆和报告。

---

## 快速开始

```bash
# 安装
cd openclaw-mrx && npm install

# 运行全部测试（15 项）
npx tsx cli/mrx-skeleton.ts test

# 所有测试套件（45 项）
npx tsx cli/mrx-skeleton.ts test      # 主套件: 15 项
npx tsx test/v1-executor-test.ts      # V1:   12 项
npx tsx test/v2-integration-test.ts   # V2:   10 项
npx tsx test/p0-new-test.ts           # P0:    8 项

# 创建 Objective 并规划
npx tsx cli/mrx-skeleton.ts run "开发股票交易系统"

# 查看状态
npx tsx cli/mrx-skeleton.ts status <objective_id>

# 检索记忆
npx tsx cli/mrx-skeleton.ts recall "JWT鉴权"

# 启动 REST API
npx tsx test/p3-api-test.ts
```

---

## 架构总览

```
                    用户目标
                         │
              ┌──────────▼──────────┐
              │  Objective Engine   │  层次化目标管理
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Hybrid Planner     │  LLM 拆解子目标 + 规则校验
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Execution Loop     │  8 阶段循环
              │  + Goal Engine      │  观察→分析→规划→执行→验证→反思→裁决→检查点
              └──────────┬──────────┘
                         │
        ┌────────────────┼───────────────────┐
        │                │                   │
  ┌─────▼─────┐  ┌──────▼──────┐  ┌─────────▼──────────┐
  │ Executor  │  │  Recovery   │  │  Checkpoint         │
  │ Registry  │  │  Engine V2  │  │  Manager V2         │
  │           │  │  (6 分支)   │  │  (SQLite 回滚)      │
  └───────────┘  └─────────────┘  └────────────────────┘
        │
  ┌─────▼─────┐  ┌──────────────┐  ┌──────────────────┐
  │ Command   │  │ File         │  │ Budget Guard     │
  │ Executor  │  │ Executor     │  │ (4 维预算)       │
  │(白名单)   │  │(路径安全)    │  │                  │
  └───────────┘  └──────────────┘  └──────────────────┘
                         │
              ┌──────────▼──────────┐
              │  State Graph        │  SQLite WAL + 租约锁
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Memory Recall      │  关键词 + BM25 + Embedding
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  QMD Lite           │  记忆 → QMD 索引 → 双源检索
              └─────────────────────┘
```

## 核心设计原则

| 原则 | 实现 |
|:---|:---|
| **目标驱动，非提示词驱动** | Objective → Goal → Task 三层架构，LLM 自主分解 |
| **DAG 任务图，非任务列表** | depends_on + children 实现真正并行执行 |
| **LLM + 规则混合** | LLM 负责创造性分解，规则负责校验、去重、循环检测 |
| **外部验证唯一标准** | 不让 LLM 自己判断自己——所有验证走真实命令 |
| **工具化执行** | 6 个内置工具（git/npm/lint），统一 Tool 接口，风险分级 |
| **混合记忆召回** | 0.3×关键词 + 0.5×语义向量 + 0.2×新鲜度 |
| **语义目标校验** | 余弦相似度 + Jaccard 回退，相似度矩阵可视化 |
| **全维度预算保护** | 迭代次数/运行时间/失败次数/Token，80% 预警，100% 阻断 |
| **检查点全覆盖** | 基于 SQLite 的状态快照，支持真正回滚 |
| **记忆闭环** | 编译器写入 → QMD 索引 → 召回引擎读取 → 上下文注入 |

## 模块地图

| 模块 | 阶段 | 说明 |
|:---|:---|:---|
| `objective/objective-engine` | P0 | 顶层目标生命周期、子目标挂载、进度计算 |
| `goal/goal-engine` | P0 | 子目标状态机、依赖解析、自动解锁 |
| `planner/goal-generator` | P0 | LLM Prompt + JSON 结构化拆解 |
| `planner/goal-validator` | P0 | 循环检测（拓扑排序）、重复检测（Jaccard）、完整性校验 |
| `planner/hierarchical-planner` | P0 | Planner 门面：LLM → 校验 → 持久化 |
| `state-graph/*` | P0 | SQLite WAL + 租约锁 + CRUD Stores + 8 表 Schema |
| `memory/keyword-extractor` | P0 | 中英文混合分词、去停用词、技术同义词扩展 |
| `memory/context-builder` | P0 | 带排名的上下文注入 |
| `memory/recall-engine` | P0 | 双源检索（本地文件 + QMD 索引）+ 30s 缓存 |
| `memory/qmd-lite-*` | P0 | BM25 搜索 + QMD 索引路径写入 |
| `memory/hybrid-recall-engine` | V2 | BM25 + Embedding + Recency 混合打分 |
| `memory/vector-store` | P0-NEW | 内置向量存储（SQLite），本地余弦相似度 |
| `checkpoint/checkpoint-v2` | P1 | SQLite 快照 + 真正回滚（状态写回库） |
| `recovery/recovery-engine-v2` | P1 | 6 分支决策树（critical 优先、skip 非关键、rollback 恢复） |
| `recovery/failure-memory` | P0-NEW | 失败模式库，6 类错误分类 + 反馈学习 |
| `validator/verifier-chain` | P1 | 三层验证链：语法 → 构建 → 测试 → 目标验收 |
| `executor/*` | V1/V2 | Command/File/Tool 执行器 + Registry 自动分发 |
| `scheduler/task-scheduler` | P0-NEW | DAG 并发调度器，PromisePool 控制并发度 |
| `supervisor/quality-manager` | P2 | 5 项质量检查 |
| `metrics/metrics-engine` | P2 | 任务/全局指标统计 |
| `api/*` | P3 | HTTP Server + 20 REST 端点（Zod + Auth + 限流） |
| `cli/mrx-skeleton` | CLI | 命令行入口 + 15 项验收测试 |

## REST API

```
POST   /api/v1/objectives                    创建 Objective
GET    /api/v1/objectives                    列出 Objectives（分页 + 筛选）
GET    /api/v1/objectives/:id                获取 Objective 详情
DELETE /api/v1/objectives/:id                删除 Objective
GET    /api/v1/objectives/:id/progress         Objective 进度（实时查询）
POST   /api/v1/objectives/:id/goals           创建 Goal
GET    /api/v1/objectives/:id/goals           列出 Goals
GET    /api/v1/goals/:id                      获取 Goal 详情
PATCH  /api/v1/goals/:id                      更新 Goal 状态
GET    /api/v1/goals/:id/progress              Goal 进度（实时查询）
POST   /api/v1/missions                       启动 Mission
GET    /api/v1/missions                       列出 Missions
GET    /api/v1/missions/:id                   获取 Mission 详情
POST   /api/v1/missions/:id/pause             暂停 Mission
POST   /api/v1/missions/:id/resume            恢复 Mission
GET    /api/v1/missions/:id/checkpoints        列出检查点
GET    /api/v1/missions/:id/checkpoints/:cp    获取检查点详情
POST   /api/v1/missions/:id/rollback           回滚到指定检查点
GET    /api/v1/reports/mission/:id             任务报告
GET    /api/v1/reports/global                  全局报告
```

认证：Bearer Token + 3 级权限（read/write/admin）+ 100 次/分钟速率限制。

## 测试套件（45/45 ✅）

```bash
npx tsx cli/mrx-skeleton.ts test      # 主套件: 15 项  (P0-V2 + API)
npx tsx test/v1-executor-test.ts       # V1:    12 项  (执行器 + 安全)
npx tsx test/v2-integration-test.ts    # V2:    10 项  (Tool + Hybrid + Semantic)
npx tsx test/p0-new-test.ts            # P0:     8 项  (调度器 + 向量 + 失败记忆)
```

| # | 测试 | 阶段 |
|:---|:---|:---|
| 1 | Objective → Goal → SQLite 完整链路 | P0 |
| 2 | SQLite 状态恢复 | P0 |
| 3 | 非法 Planner 输出拦截 | P0 |
| 4 | 循环依赖拦截 | P0 |
| 5 | Memory Recall — JWT 任务召回 | P0 |
| 6 | Memory Recall — 关键词提取 | P0 |
| 7 | QMD Lite — Ingest + Search + Dual Recall | P0 |
| 8 | Checkpoint Rollback — 创建→修改→回滚→验证 | P1 |
| 9 | Recovery V2 — 6 分支决策 | P1 |
| 10 | Verifier Chain — 3 层结构 | P1 |
| 11 | Quality Manager — 5 项质量检查 | P2 |
| 12 | Metrics Engine — 统计报告 | P2 |
| 13 | Runtime API — POST/GET/PATCH/DELETE | P3 |
| 14 | V1 — Executor + Security + Budget Guard | V1 |
| 15 | V2 — Tool Executor + Hybrid Recall + Semantic | V2 |

## 核心能力

### 规划与执行

| 能力 | 实现 |
|:---|:---|
| **目标拆解** | LLM 将自然语言目标拆解为 3-7 个子目标，规则校验去重和循环依赖 |
| **并发调度** | TaskScheduler + PromisePool，无依赖任务并行执行 |
| **工具执行** | 6 内置工具 + Command Executor（白名单 30 条 + 黑名单 15 条） |
| **文件操作** | File Executor（路径遍历/绝对路径/符号链接三重拦截） |

### 记忆与学习

| 能力 | 实现 |
|:---|:---|
| **混合召回** | 0.3×BM25 + 0.5×Embedding + 0.2×Recency，30s 缓存 |
| **向量存储** | SQLite 内置向量索引，本地余弦相似度搜索 |
| **失败学习** | 6 类错误自动分类，模式匹配 + 反馈学习 |
| **语义校验** | 余弦相似度 + Jaccard 回退，相似度矩阵可视化 |

### 容错与恢复

| 能力 | 实现 |
|:---|:---|
| **恢复决策树** | 6 分支：重试/替代方案/重新规划/回滚/跳过/升级人工 |
| **检查点回滚** | SQLite 状态快照，支持真正状态恢复 |
| **预算保护** | 4 维预算（迭代/时间/失败/Token），80% 预警，100% 阻断 |
| **失败模式库** | 记录→匹配→反馈学习，避免重复犯错 |

### 工程化

| 能力 | 实现 |
|:---|:---|
| **结构化日志** | createLogger + Trace ID 全链路追踪 + 4 级日志 |
| **结构化错误** | ErrorCode 枚举（8 种）+ MRXError（retryable）+ 统一错误包装 |
| **API 认证** | Bearer Token + 3 级权限 + 速率限制 |
| **CI/CD** | GitHub Actions: 3 Node 版本 × (tsc + 4 suites + build) |
| **性能优化** | Set 查找 O(1)、drain 事件驱动、save 防抖 |

## 设计文档

架构决策和设计文档在 workspace 的 `design/` 目录下：

| 文档 | 说明 |
|:---|:---|
| `ARCHITECTURE-FREEZE.md` | 冻结契约 + 修改规则 |
| `state-schema/mrx-state-v1.ts` | 10 个核心类型定义 |
| `events/domain-events.ts` | 47 个领域事件 |
| `contracts/planner-output.schema.json` | LLM 输出 JSON Schema |
| `contracts/openapi.yaml` | OpenAPI 3.1 规范（26 端点） |
| `adr/ADR-001-hybrid-planner.md` | 为什么选择 LLM + 规则混合架构 |
| `adr/ADR-002-sqlite-wal-state-graph.md` | 为什么用 SQLite WAL 替代 state.yaml |
| `adr/ADR-003-qmd-lite-bm25-first.md` | 为什么 BM25 优先于向量检索 |
| `adr/ADR-004-state-graph-p0-priority.md` | 为什么基础设施层优先开发 |
| `mrx-2.0-optimized-roadmap.md` | 14 阶段文件级 WBS 路线图 |

## 项目结构

```
openclaw-mrx/
├── core/              # 核心运行时
│   ├── runtime/       # Loop Engine（8 阶段主循环）
│   ├── objective/     # Objective Engine
│   ├── goal/          # Goal Engine
│   ├── planner/       # Hybrid Planner（LLM + 规则）
│   ├── executor/      # Executor Registry + Command/File/Tool
│   ├── scheduler/     # DAG 并发调度器
│   ├── recovery/      # Recovery Engine V2 + Failure Memory
│   ├── checkpoint/    # Checkpoint Manager V2
│   ├── validator/     # Verifier Chain（3 层）
│   ├── memory/        # Hybrid Recall + Vector Store + QMD Lite
│   ├── state-graph/   # SQLite WAL Stores
│   ├── metrics/       # Metrics Engine
│   ├── budget/        # Budget Guard
│   └── utils/         # Logger + Error System + Config
├── api/               # REST API
│   ├── server.ts      # HTTP Server
│   ├── routes.ts      # 20 个端点
│   ├── validators/    # Zod Schemas
│   └── middleware/     # Auth + Rate Limit
├── agents/            # Agent 层
│   └── supervisor/    # Supervisor Agent + Quality Manager
├── cli/               # CLI 入口 + 15 项验收测试
├── test/              # 专项测试（V1/V2/P0）
└── .github/workflows/ # CI/CD
```

## 阶段完成状态

```
✅ 架构冻结         (4 契约 + 4 ADR + OpenAPI)
✅ P0: 核心运行时    (7/7 — Objective, Goal, Planner, StateGraph, MemoryRecall, QMD Lite)
✅ P1: 容错恢复      (3/3 — Checkpoint Rollback, Recovery V2, Verifier Chain)
✅ P2: 监督统计      (2/2 — Quality Manager, Metrics Engine)
✅ P3: 外部 API      (1/1 — Runtime REST API + Zod + Auth)
✅ V1: 执行引擎      (5/5 — Executor, Command, File, Registry, Budget Guard)
✅ V2: 智能增强      (4/4 — Tool Executor, Hybrid Recall, Semantic Validator, Loop Execute)
✅ P0-NEW: 规模化    (3/3 — DAG Scheduler, Vector Store, Failure Memory)
✅ ENGR: 工程化      (4/4 — Logger, Auth MW, CI/CD, CONTRIBUTING)
✅ PERF: 性能优化    (4/4 — Recall Cache, Set Lookup, Event Drain, Save Debounce)
─────────────────────────────────────────────────────────
   全部阶段完成
```

## 许可证

MIT
