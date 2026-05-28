# MRX — OpenClaw Mission Runtime

> Autonomous Agent Operating System. Not a skill. A runtime.

MRX transforms an AI agent from "one-shot prompt responder" into a **persistent autonomous executor** that:

- Decomposes goals into DAG task graphs
- Loops autonomously through OBSERVE → ANALYZE → PLAN → EXECUTE → VALIDATE → REFLECT → JUDGE → CHECKPOINT
- Recovers from failures with a 6-branch decision tree
- Persists state for cross-session resume
- Compiles execution experience into structured memory

## Architecture

```
User → mission.yaml → DAG Planner → Execution Loop (8 phases) → State & Memory

                          ┌──────────────────────────────┐
                          │     SUPERVISOR AGENT          │
                          │  Auditor / Budget / Memory    │
                          └──────────────┬───────────────┘
                                         │
  ┌──────────────────────────────────────┼──────────────────────────────────────┐
  │                        EXECUTION LOOP (8 phases)                            │
  │                                                                             │
  │  OBSERVE → ANALYZE → PLAN → EXECUTE → VALIDATE → REFLECT → JUDGE           │
  │     ↑                                                          │           │
  │     └──────── RETRY / REPLAN / ROLLBACK ←──────────────────────┘           │
  └─────────────────────────────────────────────────────────────────────────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          │  state.yaml   events/        │
                          │  checkpoints/  memory/       │
                          └─────────────────────────────┘
```

## Quick Start

```bash
# Install
cd openclaw-mrx && npm install && npm run build

# Create a mission
node dist/cli/mission.js create "重构支付模块" --repo ./my-project

# Edit mission.yaml with objectives, validation, constraints...
# Then:
node dist/cli/mission.js start my-mission.yaml

# Check status
node dist/cli/mission.js status

# Resume after interruption
node dist/cli/mission.js resume my-mission-id
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

## Core Modules (16 files, ~2,800 lines)

| Module | Role |
|:---|:---|
| `dag-planner` | Goal → DAG decomposition (rule-based + LLM) |
| `loop-engine` | 8-phase autonomous execution loop |
| `reflector` | Failure root-cause analysis (8 patterns + LLM) |
| `recovery-engine` | 6-branch decision tree (RETRY/REPLAN/ROLLBACK/...) |
| `risk-engine` | 4-level risk classification (16 built-in rules) |
| `budget-controller` | Token/time/cost 3-layer budget |
| `memory-compiler` | 5-layer memory from execution traces |
| `event-bus` | 24 event types, JSONL audit trail |
| `validator` | External tool verification (no LLM self-eval) |
| `supervisor` | Independent audit + budget + memory agent |

## Phase Status

- ✅ **Phase 1**: Single-task linear execution, state persistence, checkpoint
- ✅ **Phase 2**: DAG planner, LLM reflection, recovery tree, multi-path judge
- ✅ **Phase 3**: Memory compiler, risk engine, budget controller, event bus, supervisor
- ⬜ **Phase 4**: Multi-mission parallel, UI dashboard, REST API, self-evolution

## License

MIT
