# MRX — OpenClaw Mission Runtime

> **Autonomous Agent Runtime.** Not a skill. Not a script. A long-running mission execution engine.
>
> 15 phases. 65+ files. ~16,500 lines. CI: ![CI](https://github.com/zhbcher/openclaw-mrx/actions/workflows/ci.yml/badge.svg) **55/55 tests**.
>
> ECC Deep Fusion: 63 agents · 115 rules · 249 skills — [Guide](DEEP-FUSION-GUIDE.md)
>
> 📖 [中文文档](README.zh-CN.md) | 📚 [Tutorial](TUTORIAL.md) | 📚 [中文教程](TUTORIAL.zh-CN.md)

MRX transforms an AI agent from "one-shot prompt responder" into a **persistent autonomous executor** that plans, executes, validates, recovers, remembers, and reports — across hours or days.

---

## Quick Start

> 📚 **New to MRX?** Read the [Tutorial](TUTORIAL.md) for a step-by-step guide.

```bash
# Install
cd openclaw-mrx && npm install

# Run all test suites (55 tests total)
npx tsx cli/mrx-skeleton.ts test      # Main:  15 tests
npx tsx test/v1-executor-test.ts      # V1:    12 tests
npx tsx test/v2-integration-test.ts   # V2:    10 tests
npx tsx test/p0-new-test.ts           # P0:     8 tests
npx tsx test/deep-fusion-test.ts      # ECC:    5 tests
npx tsx test/ecc-skill-executor-test.ts  # ECC:  5 tests

# Create and plan an objective
npx tsx cli/mrx-skeleton.ts run "Build a stock trading system"

# View status
npx tsx cli/mrx-skeleton.ts status <objective_id>

# Search memory
npx tsx cli/mrx-skeleton.ts recall "JWT auth"

# Export MRX agent to ECC/Claude Code format
npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export

# Start the REST API
npx tsx test/p3-api-test.ts
```

---

## Architecture (ECC Enhanced)

```
                    User Objective
                         │
              ┌──────────▼──────────┐
              │  Objective Engine   │  P0: Hierarchical goals
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Hybrid Planner     │  P0: LLM decompose + Rule validate
              │  + ECC Knowledge    │  ECC: 63 agents · 115 rules injected
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Execution Loop     │  8-phase: OBSERVE→ANALYZE→PLAN→
              │  + Goal Engine      │  EXECUTE→VALIDATE→REFLECT→JUDGE→CHECKPOINT
              │  + ECC Inject       │  ECC context injected at ANALYZE/PLAN/VALIDATE
              └──────────┬──────────┘
                         │
        ┌────────────────┼───────────────────┬──────────────────┐
        │                │                   │                  │
  ┌─────▼─────┐  ┌──────▼──────┐  ┌─────────▼──────────┐  ┌───▼──────────┐
  │ Executor  │  │  Recovery   │  │  Checkpoint         │  │  ECC Layer  │
  │ Registry  │  │  Engine V2  │  │  Manager V2         │  │  (7 modules) │
  │ (V2)      │  │ (6-branch)  │  │ (SQLite rollback)   │  │             │
  └───────────┘  └─────────────┘  └────────────────────┘  │ RuleLoader  │
        │                                                   │ AgentAdapter│
  ┌─────▼─────┐  ┌──────────────┐  ┌──────────────────┐  │ ECCVerifier │
  │ Command   │  │ File         │  │ ECCSkillExecutor │  │ ShieldGate  │
  │ Executor  │  │ Executor     │  │ (249 ECC skills)  │  └──────┬──────┘
  │(Allowlist)│  │(Path Safety) │  └──────────────────┘         │
  └───────────┘  └──────────────┘                       ┌───────▼───────┐
                         │                              │ ecc-assets/  │
              ┌──────────▼──────────┐                    │ 63 agents    │
              │  State Graph        │  P0: SQLite WAL    │ 115 rules    │
              └──────────┬──────────┘                    │ 249 skills   │
                         │                              └───────────────┘
              ┌──────────▼──────────┐
              │  Memory Recall      │  P0: BM25 + Embedding + Recency
              │  + ECC Context      │  ECC: buildWithECC() injects rules
              └─────────────────────┘
```

## Module Map

| Module | Phase | Description |
|:---|:---|:---|
| `objective/objective-engine` | P0 | Objective lifecycle, goal attachment, progress |
| `goal/goal-engine` | P0 | Goal state machine, dependency resolution |
| `planner/goal-generator` | P0 | LLM prompt + JSON extraction for Goal decomposition |
| `planner/goal-validator` | P0 | Cycle detection, duplicate detection, completeness |
| `planner/hierarchical-planner` | P0 | Facade: LLM → Validate → Persist |
| `state-graph/*` | P0 | SQLite WAL + Lease Lock + 8-table schema |
| `memory/*` | P0 | Keyword extraction, recall, context builder |
| `memory/qmd-lite-*` | P0 | BM25 search + Ingest to QMD-indexed paths |
| `checkpoint/checkpoint-v2` | P1 | SQLite-backed snapshots + real rollback |
| `recovery/recovery-engine-v2` | P1 | 6-branch decision tree |
| `validator/verifier-chain` | P1 | Syntax → Build → Test → Goal verification |
| `supervisor/quality-manager` | P2 | 5 quality checks |
| `metrics/metrics-engine` | P2 | Mission + Global metrics |
| `api/*` | P3 | HTTP server + 20 REST endpoints (zod validated) |
| `executor/*` | V1 | 4 executors: Command, File, Tool, **ECC Skill** |
| `budget/budget-guard` | V1 | 4-dim guard: iterations/runtime/failures/tokens |
| **`ecc/rule-loader`** | **ECC** | **Index 115 rules across 20 languages** |
| **`ecc/context-enricher`** | **ECC** | **Inject ECC knowledge into LLM context** |
| **`ecc/ecc-context-builder`** | **ECC** | **Wrapper for context enrichment** |
| **`ecc/agent-adapter`** | **ECC** | **Parse 63 ECC agents → System Prompts** |
| **`ecc/ecc-verifier`** | **ECC** | **Pattern-match quality gates** |
| **`ecc/shield-gate`** | **ECC** | **Security scanning (built-in + AgentShield)** |
| **`ecc/index`** | **ECC** | **Module exports** |
| **`executor/ecc-skill-executor`** | **ECC** | **Run ~20 ECC skills (Python/Shell)** |
| **`executor/executor-factory`** | **ECC** | **Unified executor registration** |

## ECC Deep Fusion

MRX integrates **affaan-m/ECC** — the industry's largest open-source Agent harness system (182K+ stars) — at three levels:

### Level 1 — Knowledge Injection
When MRX's Loop Engine enters the **ANALYZE** and **PLAN** phases, it automatically queries the ECC rule database:

```typescript
// Automatic — no configuration needed
// Task: "Build a TypeScript API gateway"
// ECC injects: TypeScript coding-style + security + testing rules into LLM prompt
```

Assets: **115 coding/security/testing rules** across 20 languages (TypeScript, Python, Go, Rust, Java, Kotlin, C++, Swift, Ruby, PHP, Angular, React, Web, C#, Dart, F#, Perl, ArkTS, Chinese).

### Level 2 — Expert Agent Adapter
63 ECC agent prompts (architect, security-reviewer, code-reviewer, etc.) are parsed into reusable System Prompts:

```typescript
import { ECCAgentAdapter, getECCRuleLoader } from "./core/ecc/index.js";
const adapter = new ECCAgentAdapter(getECCRuleLoader());
const agent = adapter.selectAgent(["typescript", "review"]);
const systemPrompt = adapter.generateSystemPrompt(agent);
// → Full system prompt with defense baseline + review priorities
```

### Level 3 — Quality Gates
ECC rules plugged into MRX's **VALIDATE** phase as extra verification layers:

| Gate | What it checks |
|:---|:---|
| Security | Hardcoded secrets, eval(), innerHTML, command injection |
| Coding Style | var instead of const/let, == vs ===, console.log |
| Testing | Missing test files, missing assertions |
| Performance | Loop-in-await, forEach-async anti-patterns |

### Level 4 — Skill Executor
249 ECC skills are discoverable and ~20 executable skills (Python/Shell) can be run via ECCSkillExecutor:

```typescript
const result = await executor.execute({
  action: { type: "ecc_skill", target: "openclaw-persona-forge", content: '{"mode":"gacha"}' }
});
```

### Level 5 — Security & Export
- **AgentShieldGate**: Built-in pattern matching + optional `ecc-agentshield` integration
- **Cross-harness export**: `npx tsx cli/export-ecc.ts --agent <name>` → ECC/Claude Code/Codex formats

See [DEEP-FUSION-GUIDE.md](DEEP-FUSION-GUIDE.md) for the complete integration guide.

## Test Suite (55/55 ✅)

```bash
npx tsx cli/mrx-skeleton.ts test      # Main:    15 tests  (core + P0-V2 + API)
npx tsx test/v1-executor-test.ts       # V1:      12 tests  (executor + security)
npx tsx test/v2-integration-test.ts    # V2:      10 tests  (tool + hybrid + semantic)
npx tsx test/p0-new-test.ts            # P0:       8 tests  (scheduler + vector + failure)
npx tsx test/deep-fusion-test.ts       # ECC:      5 tests  (rule load + agent + verify)
npx tsx test/ecc-skill-executor-test.ts   # ECC:    5 tests  (skill discovery + execution)
```

| # | Test | Suite | Phase |
|:---|:---|:---|:---|
| 1 | Objective → Goal → SQLite full chain | Main | P0 |
| 2 | SQLite state recovery | Main | P0 |
| 3 | Illegal Planner output interception | Main | P0 |
| 4 | Cycle dependency interception | Main | P0 |
| 5 | Memory Recall — JWT task recall | Main | P0 |
| 6 | Memory Recall — keyword extraction | Main | P0 |
| 7 | QMD Lite — Ingest + Search + Dual Recall | Main | P0 |
| 8 | Checkpoint Rollback — create → modify → rollback → verify | Main | P1 |
| 9 | Recovery V2 — 6-branch decision | Main | P1 |
| 10 | Verifier Chain — 3-layer structure | Main | P1 |
| 11 | Quality Manager — 5 quality checks | Main | P2 |
| 12 | Metrics Engine — statistics report | Main | P2 |
| 13 | Runtime API — POST/GET/PATCH/DELETE | Main | P3 |
| 14 | V1 — Executor + Security + Budget Guard | Main | V1 |
| 15 | V2 — Tool Executor + Hybrid Recall + Semantic | Main | V2 |
| 16-27 | V1 suite (12 tests): Executor + Security + Budget | V1 | V1 |
| 28-37 | V2 suite (10 tests): Tool + Hybrid Recall + Semantic | V2 | V2 |
| 38-45 | P0 suite (8 tests): DAG Scheduler + Vector + Failure | P0 | P0 |
| **46-50** | **ECC fusion (5 tests): Rule load + Agent + Verify** | **ECC** | **ECC** |
| **51-55** | **ECC skill executor (5 tests): Discovery + Execution** | **ECC** | **ECC** |

## V2 Capabilities

| Capability | Implementation |
|:---|:---|
| **Tool Executor** | 6 built-in tools (git.status/commit, npm.test/build/install, lint) + risk gating |
| **Hybrid Recall** | 0.3*BM25 + 0.5*Embedding + 0.2*Recency multi-signal fusion |
| **Semantic Validator** | Cosine Similarity + Jaccard fallback + similarity matrix |
| **Loop Execute** | Plan→Execute→Validate closed loop, ExecutorRegistry auto-dispatch |

## Engineering

| Feature | Implementation |
|:---|:---|
| **Structured Logging** | createLogger + Trace ID full-chain + 4 log levels |
| **Structured Errors** | ErrorCode enum (8 types) + MRXError (retryable) + withErrorHandling |
| **API Authentication** | Bearer Token + 3-tier RBAC (read/write/admin) + rate limiting |
| **CI/CD** | GitHub Actions: 3 Node versions × (tsc + 6 suites + build) |
| **Test Cleanup** | cleanupTestData() SQL-level cleanup |
| **Contributing Guide** | CONTRIBUTING.md + 2 Mission templates |

## Performance

| Optimization | Description |
|:---|:---|
| **Recall Cache** | 30s TTL, reduced from 100 I/O to once per 30s |
| **Command Set** | Allowlist Array(O(n)) → Set(O(1)) lookup |
| **drain Event-driven** | setTimeout polling → await waitOne, zero latency |
| **save Debounce** | Multiple state changes within 100ms merged into one disk write |

## Cross-harness Export

```bash
# Export MRX agent to ECC format (works in Claude Code, Codex, Cursor, OpenCode)
npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export

# Export all agents
npx tsx cli/export-ecc.ts --agents-all --format claude-code --output ./ecc-export
```

Supported output formats: `ecc`, `claude-code`, `codex`.

## Design Documents

Architecture decisions and contracts are in the `docs/` directory:

| Document | Description |
|:---|:---|
| `ARCHITECTURE-FREEZE.md` | Frozen contracts + modification rules |
| `DEEP-FUSION-GUIDE.md` | ECC integration guide |
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
✅ P0: Core Runtime     (7/7 — Objective, Goal, Planner, StateGraph, Memory, QMD Lite)
✅ P1: Resilience       (3/3 — Checkpoint Rollback, Recovery V2, Verifier Chain)
✅ P2: Supervision      (2/2 — Quality Manager, Metrics Engine)
✅ P3: External API     (1/1 — Runtime REST API + zod + Auth)
✅ V1: Executor         (5/5 — Executor, Command, File, Registry, Budget)
✅ V2: Intelligence      (4/4 — Tool Executor, Hybrid Recall, Semantic, Loop)
✅ P0-NEW: Scale         (3/3 — DAG Scheduler, Vector Store, Failure Memory)
✅ ENGR: Engineering     (4/4 — Logger, Auth MW, CI/CD, CONTRIBUTING)
✅ PERF: Optimization    (4/4 — Recall Cache, Set Lookup, Event Drain, Save Debounce)
✅ ECC: Deep Fusion      (5/5 — Rule Loader, Agent Adapter, Verifier, Shield, Export)
─────────────────────────────────────────────────────────
   ALL PHASES COMPLETE  ·  55/55 TESTS PASSING
```

## License

MIT
