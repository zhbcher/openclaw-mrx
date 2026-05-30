# MRX — OpenClaw Mission Runtime

> **Autonomous Agent Runtime.** Not a skill. Not a script. A long-running mission execution engine.
>
> 15 phases. 39 files. ~10,800 lines of code. 15/15 acceptance tests passing.

MRX transforms an AI agent from "one-shot prompt responder" into a **persistent autonomous executor** that plans, executes, validates, recovers, remembers, and reports — across hours or days.

---

## Quick Start

```bash
# Install
cd openclaw-mrx && npm install

# Run the full test suite (15 tests)
npx tsx cli/mrx-skeleton.ts test

# V2 test suite (10 tests: tool + hybrid recall + semantic)
npx tsx test/v2-integration-test.ts

# V1 executor tests
npx tsx test/v1-executor-test.ts

# Create and plan an objective
npx tsx cli/mrx-skeleton.ts run "开发股票交易系统"

# View status
npx tsx cli/mrx-skeleton.ts status <objective_id>

# Search memory
npx tsx cli/mrx-skeleton.ts recall "JWT鉴权"

# Start the REST API
npx tsx test/p3-api-test.ts   # 12 endpoint tests included
```

---

## Architecture

```
                    User Objective
                         │
              ┌──────────▼──────────┐
              │  Objective Engine   │  P0: 层次化目标
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Hybrid Planner     │  P0: LLM拆Goal + 规则校验
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Execution Loop     │  8-phase: OBSERVE→ANALYZE→PLAN→
              │  + Goal Engine      │  EXECUTE→VALIDATE→REFLECT→JUDGE→CHECKPOINT
              └──────────┬──────────┘
                         │
        ┌────────────────┼───────────────────┐
        │                │                   │
  ┌─────▼─────┐  ┌──────▼──────┐  ┌─────────▼──────────┐
  │ Executor  │  │  Recovery   │  │  Checkpoint         │
  │ Registry  │  │  Engine V2  │  │  Manager V2         │
  │ (V2)      │  │ (6-branch)  │  │ (SQLite rollback)   │
  └───────────┘  └─────────────┘  └────────────────────┘
        │
  ┌─────▼─────┐  ┌──────────────┐  ┌──────────────────┐
  │ Command   │  │ File         │  │ Budget Guard     │
  │ Executor  │  │ Executor     │  │ (V1: 4-dim)      │
  │(Allowlist)│  │(Path Safety) │  │                  │
  └───────────┘  └──────────────┘  └──────────────────┘
                         │
              ┌──────────▼──────────┐
              │  State Graph        │  P0: SQLite WAL + Lease Lock
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Memory Recall      │  P0: Keyword Extract + BM25 + Context
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  QMD Lite           │  P0: Memory → QMD index → Dual-source recall
              └─────────────────────┘
```

## Core Principles

| Principle | Implementation |
|:---|:---|
| **Goal-driven, not prompt-driven** | Objective → Goal → Task hierarchy with LLM decomposition |
| **DAG, not task list** | Tasks have `depends_on` + `children`, enabling parallel execution |
| **LLM + Rules hybrid** | LLM does creative Goal decomposition; rules handle validation, dedup, cycle detection |
| **External verification only** | Never let the LLM judge its own success — all validation runs real commands |
| **Execute with tools** | 6 built-in tools (git/npm/lint) via unified Tool interface + risk gating |
| **Hybrid memory** | 0.3*BM25 + 0.5*Embedding + 0.2*Recency — multi-signal fusion recall |
| **Semantic validation** | Cosine similarity via embeddings + Jaccard fallback for goal dedup |
| **Budget everywhere** | 4-dimension guard: iterations, runtime, failures, tokens — 80% warn, 100% block |
| **Checkpoint everything** | SQLite-based state snapshots enable true rollback (not just file copies) |
| **Memory is a loop** | Compiler writes → QMD indexes → Recall Engine reads → Context injected |

## Module Map

| Module | Phase | Description |
|:---|:---|:---|
| `objective/objective-engine` | P0 | Objective lifecycle, goal attachment, progress calculation |
| `goal/goal-engine` | P0 | Goal state machine, dependency resolution, auto-unlock |
| `planner/goal-generator` | P0 | LLM prompt + JSON extraction for Goal decomposition |
| `planner/goal-validator` | P0 | Cycle detection (topological), duplicate detection (Jaccard), completeness |
| `planner/hierarchical-planner` | P0 | Facade orchestrating LLM → Validate → Persist |
| `state-graph/*` | P0 | SQLite WAL + Lease Lock + CRUD stores + 8-table schema |
| `memory/keyword-extractor` | P0 | Sino-English tokenizer, stop-word removal, tech synonym expansion |
| `memory/context-builder` | P0 | Ranked context injection into execution prompts |
| `memory/recall-engine` | P0 | Dual-source search (local files + QMD index) |
| `memory/qmd-lite-*` | P0 | BM25 search + Ingest to QMD-indexed paths |
| `checkpoint/checkpoint-v2` | P1 | SQLite-backed snapshots + real rollback (writes state back) |
| `recovery/recovery-engine-v2` | P1 | 6-branch decision tree (critical-first, skip non-critical, rollback) |
| `validator/verifier-chain` | P1 | 3-layer chain: Syntax → Build → Test → Goal |
| `supervisor/quality-manager` | P2 | 5 quality checks: type-safety, lint, coverage, docs, error-handling |
| `metrics/metrics-engine` | P2 | Mission + Global metrics, formatted reports |
| `api/server` + `api/routes` | P3 | HTTP server + 20 REST endpoints (zod validated) |
| `api/validators/schemas` | V1 | Zod schemas for all API inputs |
| **`executor/executor`** | **V1** | **Executor abstraction (TaskInput → TaskResult)** |
| **`executor/command-executor`** | **V1** | **Shell execution: Allowlist 30 + Blocklist 15 + Timeout** |
| **`executor/file-executor`** | **V1** | **Safe file I/O: path traversal / absolute / symlink blocking** |
| **`executor/executor-registry`** | **V1** | **Auto-dispatch by action.type + fail-fast** |
| **`budget/budget-guard`** | **V1** | **4-dim guard: iterations/runtime/failures/tokens** |

## API Endpoints

```
POST   /api/v1/objectives                    Create Objective (zod validated)
GET    /api/v1/objectives                    List Objectives (pagination + filters)
GET    /api/v1/objectives/:id                Get Objective
DELETE /api/v1/objectives/:id                Delete Objective
GET    /api/v1/objectives/:id/progress        Objective Progress
POST   /api/v1/objectives/:id/goals           Create Goal (zod validated)
GET    /api/v1/objectives/:id/goals           List Goals
GET    /api/v1/goals/:id                      Get Goal
PATCH  /api/v1/goals/:id                      Update Goal (zod validated)
GET    /api/v1/goals/:id/progress             Goal Progress
POST   /api/v1/missions                       Start Mission (zod validated)
GET    /api/v1/missions                       List Missions (pagination)
GET    /api/v1/missions/:id                   Get Mission
POST   /api/v1/missions/:id/pause             Pause Mission
POST   /api/v1/missions/:id/resume            Resume Mission
GET    /api/v1/missions/:id/checkpoints        List Checkpoints
GET    /api/v1/missions/:id/checkpoints/:cp    Get Checkpoint
POST   /api/v1/missions/:id/rollback           Rollback (zod validated)
GET    /api/v1/reports/mission/:id             Mission Report
GET    /api/v1/reports/global                  Global Report
```

## Test Suite (15/15 ✅)

```bash
npx tsx cli/mrx-skeleton.ts test
```

| # | Test | Phase |
|:---|:---|:---|
| 1 | Objective → Goal → SQLite full chain | P0 |
| 2 | SQLite state recovery | P0 |
| 3 | Illegal Planner output interception | P0 |
| 4 | Cycle dependency interception | P0 |
| 5 | Memory Recall — JWT task recall | P0 |
| 6 | Memory Recall — keyword extraction | P0 |
| 7 | QMD Lite — Ingest + Search + Dual Recall | P0 |
| 8 | Checkpoint Rollback — create → modify → rollback → verify | P1 |
| 9 | Recovery V2 — 6-branch decision | P1 |
| 10 | Verifier Chain — 3-layer structure | P1 |
| 11 | Quality Manager — 5 quality checks | P2 |
| 12 | Metrics Engine — statistics report | P2 |
| 13 | Runtime API — POST/GET/PATCH/DELETE (zod validated) | P3 |
| 14 | V1 — Executor + Security + Budget Guard | V1 |
| 15 | V2 — Tool Executor + Hybrid Recall + Semantic | V2 |

## V2 新增能力

| 能力 | 实现 |
|:---|:---|
| **Tool Executor** | 6 内置工具 (git.status/commit, npm.test/build/install, lint) + 风险分级 |
| **Hybrid Recall** | 0.3*BM25 + 0.5*Embedding + 0.2*Recency 混合打分 |
| **Semantic Validator** | Cosine Similarity + Jaccard fallback + 相似度矩阵可视化 |
| **Loop Execute** | Plan→Execute→Validate 闭环, ExecutorRegistry 3种executor自动分发 |

## V1 新增能力

| 能力 | 实现 |
|:---|:---|
| **任务执行** | Command Executor (Allowlist 30条 + Blocklist 15条 + Timeout) |
| **文件操作** | File Executor (path traversal / absolute path / symlink blocking) |
| **自动分发** | Executor Registry (auto-dispatch by action.type, fail-fast mode) |
| **安全沙箱** | Workspace Boundary + Command Allowlist/Blocklist |
| **预算保护** | Budget Guard (4-dim: iterations/runtime/failures/tokens, 80% warn, 100% block) |
| **API 校验** | Zod schemas (prevents NaN→SQL, type-safe inputs) |
| **DB 索引** | 7 new indexes (goals/tasks/missions/memory — eliminates full table scans) |

## Design Documents

Architecture decisions and contracts are in the workspace `design/` directory:

| Document | Description |
|:---|:---|
| `ARCHITECTURE-FREEZE.md` | Frozen contracts + modification rules |
| `state-schema/mrx-state-v1.ts` | 10 core type definitions |
| `events/domain-events.ts` | 47 domain events |
| `contracts/planner-output.schema.json` | LLM output JSON Schema |
| `contracts/openapi.yaml` | OpenAPI 3.1 spec (26 endpoints) |
| `adr/ADR-001-hybrid-planner.md` | Why LLM + Rules hybrid |
| `adr/ADR-002-sqlite-wal-state-graph.md` | Why SQLite WAL over state.yaml |
| `adr/ADR-003-qmd-lite-bm25-first.md` | Why BM25 before vector search |
| `adr/ADR-004-state-graph-p0-priority.md` | Why infrastructure first |
| `mrx-2.0-optimized-roadmap.md` | 14-phase file-level WBS |

## Phase Completion Status

```
✅ Architecture Freeze  (4 contracts + 4 ADRs + OpenAPI)
✅ P0: Core Runtime     (7/7 — Objective, Goal, Planner, StateGraph, MemoryRecall, QMD Lite)
✅ P1: Resilience       (3/3 — Checkpoint Rollback, Recovery V2, Verifier Chain)
✅ P2: Supervision      (2/2 — Quality Manager, Metrics Engine)
✅ P3: External API     (1/1 — Runtime REST API + zod validation)
✅ V1: Executor         (5/5 — Executor, Command, File, Registry, Budget Guard)
✅ V2: Intelligence      (4/4 — Tool Executor, Hybrid Recall, Semantic Validator, Loop Execute)
─────────────────────────────────────────────────────────
   15/15 PHASES COMPLETE
```

## License

MIT
