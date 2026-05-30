# MRX — OpenClaw Mission Runtime

> **Autonomous Agent Runtime.** Not a skill. Not a script. A long-running mission execution engine.
>
> 13 phases. 28 new files. ~7,100 lines of code. 13/13 acceptance tests passing.

MRX transforms an AI agent from "one-shot prompt responder" into a **persistent autonomous executor** that plans, executes, validates, recovers, remembers, and reports — across hours or days.

---

## Quick Start

```bash
# Install
cd openclaw-mrx && npm install

# Run the walking skeleton test suite (13 tests)
npx tsx cli/mrx-skeleton.ts test

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
  │ Verifier  │  │  Recovery   │  │  Checkpoint         │
  │ Chain     │  │  Engine V2  │  │  Manager V2         │
  │ (3-layer) │  │ (6-branch)  │  │ (SQLite rollback)   │
  └───────────┘  └─────────────┘  └────────────────────┘
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
| **Checkpoint everything** | SQLite-based state snapshots enable true rollback (not just file copies) |
| **Memory is a loop** | Compiler writes → QMD indexes → Recall Engine reads → Context injected |

## Module Map

| Module | Lines | Phase | Description |
|:---|:---|:---|:---|
| `objective/objective-engine` | 218 | P0 | Objective lifecycle, goal attachment, progress calculation |
| `goal/goal-engine` | 106 | P0 | Goal state machine, dependency resolution, auto-unlock |
| `planner/goal-generator` | 167 | P0 | LLM prompt + JSON extraction for Goal decomposition |
| `planner/goal-validator` | 275 | P0 | Cycle detection (topological), duplicate detection (Jaccard), completeness |
| `planner/hierarchical-planner` | 157 | P0 | Facade orchestrating LLM → Validate → Persist |
| `state-graph/database` | 108 | P0 | SQLite singleton, WAL mode, schema migration |
| `state-graph/objective-store` | 78 | P0 | Objective CRUD over SQLite |
| `state-graph/goal-store` | 97 | P0 | Goal CRUD + cycle detection helper |
| `state-graph/transaction-manager` | 87 | P0 | Lease Lock (TTL-based, auto-expire on crash) |
| `state-graph/schema.sql` | 162 | P0 | 8 tables: objectives, goals, tasks, missions, events, checkpoints, locks, memory |
| `memory/keyword-extractor` | 194 | P0 | Sino-English tokenizer, stop-word removal, tech synonym expansion |
| `memory/context-builder` | 177 | P0 | Ranked context injection into execution prompts |
| `memory/recall-engine` | 311 | P0 | Dual-source search (local files + QMD index) |
| `memory/qmd-lite-client` | 259 | P0 | BM25 search over QMD-indexed markdown files |
| `memory/qmd-lite-ingest` | 184 | P0 | Memory Compiler → QMD-indexed path writer |
| `checkpoint/checkpoint-v2` | 252 | P1 | SQLite-backed snapshots + real rollback (writes state back) |
| `recovery/recovery-engine-v2` | 140 | P1 | 6-branch decision tree (critical-first, skip non-critical, rollback on checkpoint) |
| `validator/verifier-chain` | 291 | P1 | 3-layer chain: Syntax → Build → Test → Goal (custom commands/output/files) |
| `supervisor/quality-manager` | 184 | P2 | 5 quality checks: type-safety, lint, coverage, docs, error-handling |
| `metrics/metrics-engine` | 284 | P2 | Mission + Global metrics, formatted reports |
| `api/server` | 131 | P3 | HTTP server (zero external deps, Node.js built-in http) |
| `api/routes` | 299 | P3 | 20 REST endpoints across 7 resource groups |
| `cli/mrx-skeleton` | 621 | CLI | 13 acceptance tests, run/status/list/recall commands |

## API Endpoints

```
POST   /api/v1/objectives                    Create Objective
GET    /api/v1/objectives                    List Objectives
GET    /api/v1/objectives/:id                Get Objective
DELETE /api/v1/objectives/:id                Delete Objective
GET    /api/v1/objectives/:id/progress        Objective Progress
POST   /api/v1/objectives/:id/goals           Create Goal
GET    /api/v1/objectives/:id/goals           List Goals
GET    /api/v1/goals/:id                      Get Goal
PATCH  /api/v1/goals/:id                      Update Goal
GET    /api/v1/goals/:id/progress             Goal Progress
POST   /api/v1/missions                       Start Mission
GET    /api/v1/missions                       List Missions
GET    /api/v1/missions/:id                   Get Mission
POST   /api/v1/missions/:id/pause             Pause Mission
POST   /api/v1/missions/:id/resume            Resume Mission
GET    /api/v1/missions/:id/checkpoints        List Checkpoints
GET    /api/v1/missions/:id/checkpoints/:cp    Get Checkpoint
POST   /api/v1/missions/:id/rollback           Rollback
GET    /api/v1/reports/mission/:id             Mission Report
GET    /api/v1/reports/global                  Global Report
```

## Test Suite (13/13 ✅)

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
| 13 | Runtime API — POST/GET/PATCH/DELETE | P3 |

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
| `mrx-2.0-optimized-roadmap.md` | 13-phase file-level WBS |

## Phase Completion Status

```
✅ Architecture Freeze  (4 contracts + 4 ADRs + OpenAPI)
✅ P0: Core Runtime     (7/7 — Objective, Goal, Planner, StateGraph, MemoryRecall, QMD Lite)
✅ P1: Resilience       (3/3 — Checkpoint Rollback, Recovery V2, Verifier Chain)
✅ P2: Supervision      (2/2 — Quality Manager, Metrics Engine)
✅ P3: External API     (1/1 — Runtime REST API)
─────────────────────────────────────────────────────────
   13/13 PHASES COMPLETE
```

## License

MIT
