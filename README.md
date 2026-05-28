# MRX — OpenClaw Mission Runtime

> Autonomous Agent Operating System. Not a skill. A runtime.

MRX transforms an AI agent from "one-shot prompt responder" into a **persistent autonomous executor** that:

- Decomposes goals into DAG task graphs (rule-based + LLM dual engine)
- Loops autonomously through 8 phases: OBSERVE → ANALYZE → PLAN → EXECUTE → VALIDATE → REFLECT → JUDGE → CHECKPOINT
- Recovers from failures with a 6-branch decision tree (RETRY/REPLAN/ROLLBACK/ALTERNATIVE/ASK_HUMAN/SKIP)
- Persists state for cross-session resume (state.yaml + SQLite registry + checkpoint snapshots)
- Compiles execution experience into 5-layer structured memory
- Runs multiple missions concurrently with priority-based scheduling
- Exposes a REST API for programmatic control

## Architecture

```
                         ┌──────────────────┐
                         │    REST API       │
                         │  GET/POST /api/*  │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼─────────┐  ┌──────▼──────┐  ┌────────▼────────┐
    │  Mission Registry │  │  Scheduler  │  │  Event Bus       │
    │  (SQLite)         │  │  (parallel) │  │  (24 types)      │
    └───────────────────┘  └─────────────┘  └─────────────────┘
              │                   │
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────┐
              │   DAG Planner     │
              │ rule-based + LLM  │
              └─────────┬─────────┘
                        │
  ┌─────────────────────┼─────────────────────────────────────────┐
  │               EXECUTION LOOP (8 phases)                       │
  │                                                               │
  │  OBSERVE → ANALYZE → PLAN → EXECUTE → VALIDATE                │
  │     ↑                                         │               │
  │     └─── REFLECT ←── JUDGE ←──────────────────┘               │
  │                │                                               │
  │                ▼                                               │
  │           CHECKPOINT                                           │
  └───────────────────────────────────────────────────────────────┘
              │                   │
    ┌─────────▼─────────┐  ┌──────▼──────────┐
    │  Recovery Engine  │  │  Supervisor     │
    │  6-branch tree    │  │  Auditor+Budget │
    └───────────────────┘  └─────────────────┘
              │
    ┌─────────▼──────────────────────────────┐
    │  state.yaml · registry.db · events/    │
    │  checkpoints/ · memory/ · logs/        │
    └────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
cd openclaw-mrx && npm install && npm run build

# --- CLI Mode ---

# Create a mission
node dist/cli/mission.js create "重构支付模块" --repo ./my-project

# Edit mission.yaml with objectives, validation, constraints...
# Then:
node dist/cli/mission.js start my-mission.yaml

# Check status
node dist/cli/mission.js status

# Resume after interruption
node dist/cli/mission.js resume my-mission-id

# --- API Server Mode ---

# Start the REST API (default port 3099)
npm run api
# or
node dist/cli/mission.js api 3099
```

## REST API

```
GET    /health                      Health check
GET    /api/stats                   Global scheduler stats
GET    /api/missions                List all missions
GET    /api/missions?status=running  Filter by status
POST   /api/missions                Create mission
GET    /api/missions/:id            Mission detail
POST   /api/missions/:id/start      Start mission
POST   /api/missions/:id/pause      Pause mission
POST   /api/missions/:id/resume     Resume paused mission
GET    /api/missions/:id/events     SSE event stream
```

Create mission example:
```bash
curl -X POST http://localhost:3099/api/missions \
  -H "Content-Type: application/json" \
  -d '{"id":"my-mission","name":"My Mission","config_path":"path/to/mission.yaml","priority":7}'
```

## Mission DSL

```yaml
mission:
  id: my-refactor
  name: "支付系统重构"
  priority: high

objective:
  - "迁移到 Stripe v15"
  - "保持 API 兼容"

validation:
  commands:
    - "npm test"
    - "npm run build"

budget:
  max_iterations: 50
  max_duration_hours: 12

risk_policy:
  require_approval: [rm_rf, database_migration]
```

## Core Modules (21 files, ~5,100 lines)

| Module | Role | Phase |
|:---|:---|---:|
| `types` | Type system (24 events, 14 statuses, 7 task states) | 1 |
| `state-manager` | state.yaml CRUD + lock | 1 |
| `mission-parser` | Mission DSL → Config + validation + template | 1 |
| `validator` | External tool verification (no LLM self-eval) | 1 |
| `checkpoint` | Snapshot system with summary generation | 1 |
| `openclaw-adapter` | Platform abstraction layer | 1 |
| `dag-planner` | Goal → DAG (rule-based + LLM dual engine) | 2 |
| `reflector` | Failure root-cause analysis (8 patterns + LLM) | 2 |
| `recovery-engine` | 6-branch decision tree | 2 |
| `loop-engine` | 8-phase autonomous execution loop | 1-3 |
| `memory-compiler` | 5-layer knowledge from execution traces | 3 |
| `risk-engine` | 4-level risk (16 built-in rules) | 3 |
| `budget-controller` | Token/time/cost 3-layer budget | 3 |
| `event-bus` | 24 event types, JSONL persistence | 3 |
| `supervisor` | Independent audit + budget + memory agent | 3 |
| `mission-registry` | SQLite-based mission lifecycle | 4a |
| `mission-scheduler` | Priority-based concurrent execution | 4a |
| `api-server` | REST API (9 endpoints + SSE) | 4a |
| `cli` | CLI (create/start/status/resume/checkpoints/api) | 1-4a |

## Phase Status

- ✅ **Phase 1**: Single-task linear execution, state persistence, checkpoint, CLI
- ✅ **Phase 2**: DAG planner, LLM reflection, recovery tree, multi-path judge
- ✅ **Phase 3**: Memory compiler, risk engine, budget controller, event bus, supervisor agent
- ✅ **Phase 4a**: SQLite registry, multi-mission scheduler, REST API (9 endpoints + SSE)
- ⬜ **Phase 4b**: UI dashboard, self-evolution engine

## License

MIT
