# MRX Tutorial — From Zero to Autonomous Agent

> Hands-on guide for running your first autonomous mission with MRX.

---

## 1. Installation

```bash
git clone https://github.com/zhbcher/openclaw-mrx.git
cd openclaw-mrx
npm install
```

Verify installation:

```bash
npx tsc --noEmit          # TypeScript: zero errors
npx tsx cli/mrx-skeleton.ts test   # Main suite: 15/15 pass
npx tsx test/deep-fusion-test.ts   # ECC: 5/5 pass
```

## 2. Your First Mission

### 2.1 Create a Mission DSL file

```yaml
# my-first-mission.yaml
version: 1

mission:
  id: hello-mrx
  name: "Hello MRX"
  description: "My first autonomous mission"
  priority: medium

objective:
  - "Show that MRX can plan and execute autonomously"

context:
  repo: "."            # current directory

constraints:
  - "No destructive operations"

environment:
  working_dir: "."

validation:
  commands:
    - "ls -la"         # verify files exist
    - "echo 'All checks passed'"

success_conditions:
  type: all_of
  conditions:
    - "planning_completed"
    - "goals_created"

budget:
  max_tokens: 100000
  max_duration_hours: 1
  max_iterations: 10
  max_failures_per_task: 3
  warning_threshold: 0.8

checkpoint:
  enabled: true
  strategy: phase

memory:
  enabled: true
  persist: true
  compile_after: true

autonomy:
  retry_enabled: true
  self_healing: true
  auto_continue: true
```

### 2.2 Run the Mission via CLI

```bash
# Quick start — create an Objective with a one-liner
npx tsx cli/mrx-skeleton.ts run "Build a stock trading system with backtesting engine"

# Expected output:
# 🎯 Creating Objective: Build a stock trading system...
# 🧠 LLM decomposing Goals...
#    Generated 4 Goals
# 🔍 Goal Validator checking...
#    ✅ Validation passed
# 💾 Persisting to State Graph (SQLite)...
#    ✅ 4 Goals written to database
```

### 2.3 View Mission Status

```bash
# List all objectives
npx tsx cli/mrx-skeleton.ts list

# View detailed status
npx tsx cli/mrx-skeleton.ts status <objective_id>

# Example output:
# 📊 Objective: Build a stock trading system
#    ID: obj_1717069200000
#    Status: running
#    Progress: 0%
#    Goals: 4
#
#    Goal Tree:
#      🟢 goal_market_data: Market Data Module (ready)
#      ⏳ goal_backtest: Backtesting Engine (pending) ← [goal_market_data]
#      ⏳ goal_trading: Trading Execution (pending) ← [goal_market_data, goal_backtest]
#      ⏳ goal_risk: Risk Control (pending) ← [goal_trading]
```

## 3. Mission DSL Deep Dive

The Mission DSL is the heart of MRX. Here's every field explained:

### 3.1 Mission Metadata

```yaml
mission:
  id: unique-mission-id          # Required: unique identifier
  name: "Human readable name"    # Required: display name
  description: "Description"     # Optional: longer description
  priority: high                 # low | medium | high | critical
```

### 3.2 Objective

```yaml
objective:
  - "Primary goal description"
  - "Secondary goal"
  - "Tertiary goal"
```

MRX's Hybrid Planner will decompose these into a DAG of sub-goals, each with dependencies, deliverables, and complexity estimates.

### 3.3 Budget Control

```yaml
budget:
  max_tokens: 1_000_000          # Maximum tokens to consume
  max_duration_hours: 12         # Maximum runtime
  max_cost_usd: 50               # Maximum cost
  max_iterations: 50             # Maximum loop iterations
  max_failures_per_task: 3       # Retries per task
  warning_threshold: 0.8         # Warn at 80% consumption
```

The Budget Guard monitors all 4 dimensions in real-time. At 80%, it warns. At 100%, it blocks.

### 3.4 Validation

```yaml
validation:
  commands:
    - "npm test"                 # Run tests
    - "npm run lint"             # Lint check
    - "npm run build"            # Build check
    - "npx tsc --noEmit"         # Type check
```

**Critical rule**: MRX never lets the LLM judge its own success. All validation is external — real commands return real pass/fail results.

### 3.5 Checkpoint & Recovery

```yaml
checkpoint:
  enabled: true
  strategy: phase               # phase | interval | manual
  interval_minutes: 30          # For interval strategy

autonomy:
  retry_enabled: true           # Retry failed tasks
  self_healing: true            # Auto-switch strategies
  auto_continue: true           # Resume after pause
```

MRX creates SQLite-backed checkpoints after each loop phase. If a task fails:
1. **Retry** — temporary errors (network timeout, build flake)
2. **Alternative** — same goal, different approach
3. **Rollback** — return to last checkpoint
4. **Skip** — non-critical path, move on
5. **Escalate** — requires human intervention

### 3.6 Security Policy

```yaml
risk_policy:
  require_approval:             # Operations needing confirmation
    - rm_rf
    - database_migration
    - production_deploy
    - npm_publish
  block:                        # Never allowed
    - outside_working_dir       # Cannot access files outside workspace
```

## 4. Core Operations

### 4.1 Working with Objectives

```bash
# Create
npx tsx cli/mrx-skeleton.ts run "Description of your objective"

# List all
npx tsx cli/mrx-skeleton.ts list

# View details + goals
npx tsx cli/mrx-skeleton.ts status <objective_id>
```

### 4.2 Memory Recall

MRX remembers past missions. Before executing a task, it searches its memory:

```bash
# Search memory for related experience
npx tsx cli/mrx-skeleton.ts recall "JWT authentication"

# Expected output:
# 🧠 [Local+QMD] Found 9 related memories (Failures:1 Solutions:1 Decisions:1 Patterns:0 Knowledge:0)
#   🔝 Top: [solution] JWT refresh token rotation (83%)
```

The Hybrid Recall Engine combines:
- **0.3 × BM25** (keyword match)
- **0.5 × Embedding** (semantic similarity via QMD vectors)
- **0.2 × Recency** (fresher memories weighted higher)

### 4.3 REST API

Start the API server:

```bash
npx tsx test/p3-api-test.ts    # Starts on port 3621, runs 12 endpoint tests
```

Key endpoints:

```bash
# Create Objective
curl -X POST http://localhost:3620/api/v1/objectives \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mrx-dev-key" \
  -d '{"title": "My Objective"}'

# List Objectives
curl http://localhost:3620/api/v1/objectives \
  -H "Authorization: Bearer mrx-dev-key"

# Get Progress
curl http://localhost:3620/api/v1/objectives/{id}/progress \
  -H "Authorization: Bearer mrx-dev-key"

# Pause Mission
curl -X POST http://localhost:3620/api/v1/missions/{id}/pause \
  -H "Authorization: Bearer mrx-dev-key"

# Rollback
curl -X POST http://localhost:3620/api/v1/missions/{id}/rollback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mrx-dev-key" \
  -d '{"checkpoint_id": "cp_..."}'

# Global Report
curl http://localhost:3620/api/v1/reports/global \
  -H "Authorization: Bearer mrx-dev-key"
```

Full API reference: 20 endpoints across 7 resource groups (Objectives, Goals, Tasks, Missions, Checkpoints, Events, Reports). See `docs/contracts/openapi.yaml`.

## 5. Mission Templates

### 5.1 Code Refactoring

```yaml
mission:
  id: refactor-to-typescript
  name: "TypeScript Migration"
  description: "Migrate codebase from JavaScript to TypeScript"
  priority: high

objective:
  - "Configure TypeScript build environment"
  - "Migrate modules one by one"
  - "Ensure all tests pass"

validation:
  commands:
    - "npx tsc --noEmit"
    - "npm test"
    - "npm run build"

budget:
  max_iterations: 50
  max_duration_hours: 12
```

### 5.2 Security Audit

```yaml
mission:
  id: security-audit
  name: "Dependency Security Audit"
  priority: critical

objective:
  - "Scan dependencies for vulnerabilities"
  - "Fix high-severity issues"
  - "Verify fixes don't break functionality"

validation:
  commands:
    - "npm audit --audit-level=high"
    - "npm test"

risk_policy:
  require_approval:
    - npm_publish
```

### 5.3 Performance Optimization

```yaml
mission:
  id: perf-optimize
  name: "API Response Time Optimization"
  priority: high

objective:
  - "Baseline current performance metrics"
  - "Identify bottlenecks"
  - "Implement optimizations"
  - "Verify improvements"

validation:
  commands:
    - "npm run benchmark"
    - "npm test"

budget:
  max_iterations: 30
  max_duration_hours: 6
```

## 6. Advanced Features

### 6.1 DAG Parallel Execution

The TaskScheduler automatically parallelizes independent tasks:

```typescript
// Tasks A and B have no dependencies → run in parallel
// Task C depends on both A and B → waits for completion
Goal: Backtesting Engine
  ├── Task A: Design architecture    (no deps, runs immediately)
  ├── Task B: Set up test framework  (no deps, runs in parallel with A)
  └── Task C: Implement engine       (depends on A, B — runs after both complete)
```

### 6.2 Failure Learning

The Failure Memory records patterns and learns:

```
1st failure: "ECONNREFUSED during npm install"
  → Recorded: errorType=network, solution="use mirror registry"

2nd failure: "ECONNREFUSED during npm install"
  → Matched existing pattern, auto-applies: "use mirror registry"
```

### 6.3 Vector Search

Built-in SQLite vector store with cosine similarity:

```typescript
const store = new VectorStore();
store.insert({ id: "v1", content: "JWT auth", embedding: [...], category: "memory" });

// Search: returns semantically similar entries
const results = store.search(queryEmbedding, "memory", 5);
```

## 7. Troubleshooting

### Common Issues

**"OpenClaw API unavailable"**
→ This appears when the LLM API isn't reachable. MRX falls back to mock planner output for testing. Connect to OpenClaw Gateway to use real LLM.

**"UNIQUE constraint failed"**
→ Clean test data before re-running: `rm -f data/mrx.db` or use `cleanupTestData()`.

**Tests hang on API test**
→ Previous test runs may leave port 3621/3622 occupied. Kill leftover processes:
```bash
lsof -ti:3621 -ti:3622 | xargs kill -9
```

### Debugging

Enable verbose logging:

```bash
# Set debug log level
MRX_LOG_LEVEL=debug npx tsx cli/mrx-skeleton.ts run "..."
```

View EventBus history:

```typescript
const events = eventBus.queryEvents({
  kind: "TASK_FAILED",
  missionId: "my-mission",
  limit: 20,
});
```

---

## Quick Reference

| Command | Description |
|:---|:---|
| `npx tsx cli/mrx-skeleton.ts run "..."` | Create Objective + plan |
| `npx tsx cli/mrx-skeleton.ts list` | List all Objectives |
| `npx tsx cli/mrx-skeleton.ts status <id>` | View Objective + Goals |
| `npx tsx cli/mrx-skeleton.ts recall "..."` | Search memory |
| `npx tsx cli/mrx-skeleton.ts test` | Run all tests |
| `rm -f data/mrx.db` | Reset database |
| `npx tsx test/p3-api-test.ts` | Start API server |

## 8. ECC Deep Fusion

MRX integrates **affaan-m/ECC** (182K+ stars) — the industry's largest open-source Agent ecosystem — to supercharge your missions with 63 expert agents, 115 coding rules, and 249 skill documents.

### 8.1 What ECC Brings

| Asset | Count | Purpose |
|:---|:---:|:---|
| Expert Agents | 63 | Role-specific prompts (security-reviewer, architect, code-reviewer…) |
| Coding Rules | 115 | Best-practice rules across 20 languages |
| Skill Documents | 249 | Knowledge documents for LLM context |
| Executable Skills | ~20 | Python/Shell scripts (continuous-learning, persona-forge…) |

### 8.2 How It Integrates

ECC knowledge is automatically injected into MRX's execution loop at three points:

**1. ANALYZE Phase** — Task keywords matched against ECC agent and rule database.

**2. PLAN Phase** — ECC coding rules and expert instructions guide Planner output.

**3. VALIDATE Phase** — After standard validation, ECC security and quality rules run as an extra gate.

### 8.3 Using ECC Experts

```typescript
import { ECCAgentAdapter, getECCRuleLoader } from "./core/ecc/index.js";

const loader = getECCRuleLoader();
await loader.initialize();
const adapter = new ECCAgentAdapter(loader);

// Select agent by task keywords, get full System Prompt
const agent = adapter.selectAgent(["security", "review"]);
const context = adapter.buildAgentContext(agent);
// → context.systemPrompt includes defense baseline + review priorities
```

### 8.4 Cross-harness Export

```bash
# Export MRX agent to Claude Code / Codex / Cursor format
npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export
npx tsx cli/export-ecc.ts --agents-all --format claude-code --output ./claude-agents
```

### 8.5 ECC Tests

ECC fusion adds 10 tests (55 total):

```bash
npx tsx test/deep-fusion-test.ts           # 5 tests: rules/agents/verify
npx tsx test/ecc-skill-executor-test.ts    # 5 tests: discovery/execution
```

## Next Steps

1. Read the [Architecture Design](docs/mission-runtime-proposal.md)
2. Review [Architecture Decisions](docs/adr/)
3. Explore the [OpenAPI Specification](docs/contracts/openapi.yaml)
4. Read the [Contributing Guide](CONTRIBUTING.md)
5. Dive into the [ECC Fusion Guide](DEEP-FUSION-GUIDE.md)
