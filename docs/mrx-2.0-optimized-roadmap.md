# MRX 2.0 优化版重构路线图

> 基准：当前 MRX 源码 3930 行（16 个文件）
> 输入：龙虾的架构审计 + 旺财的设计提案 + 实际基础设施约束
> 日期：2026-05-30

---

## 〇、上下文约束（哪些能做、哪些暂时不能做）

### 0.1 硬约束

| 约束 | 说明 | 影响 |
|:---|:---|:---|
| QMD 向量检索不可用 | `searchMode: "search"`（BM25-only），node-llama-cpp 死锁 | QMD Adapter 只能用 BM25，不能做 Hybrid Search |
| Node.js v24.15.0 | 运行环境 | 无限制，SQLite 用 better-sqlite3 原生模块 |
| macOS arm64 | 本地开发机 | 不支持 Linux-only 工具 |
| 现有记忆系统 | MEMORY.md + memory/*.md + TDAI scene blocks + 编译 wiki | 已有记忆基础设施，Memory Recall 可以直接接入 |

### 0.2 软约束

| 约束 | 说明 |
|:---|:---|
| 不能引入外部向量服务 | 本地优先，不依赖 Pinecone/Qdrant Cloud |
| 不破坏现有 OpenClaw 技能体系 | MRX 作为 Runtime Layer 叠加，不是替换 |
| 保持 TypeScript 单一语言栈 | 不引入 Python/Rust 依赖（SQLite 除外） |

---

## 一、龙虾决策采纳清单

以下来自龙虾的架构决策，**直接采纳**：

### ✅ 1. Hybrid Planner（LLM + 规则双层）

```
Objective
   ↓
Goal Generator（LLM）
   ↓
Goal Validator（规则：去重/循环检测/完整性）
   ↓
DAG Builder（规则：Goal → Epic → Task 逐层展开）
```

**理由**：纯 LLM 结果不稳定（同一目标两次拆解不同），纯规则泛化能力为零。LLM 负责"创造性拆解"那一下，剩下都是确定性规则。

### ✅ 2. State Graph 提到 P0（第 5 位）

原路线图放在 P1 第 9 位，龙虾指出这是基础设施层不是业务层。
调整后顺序：Objective → Goal → Planner → API Spec → **State Graph** → Memory Recall → QMD Lite

### ✅ 3. QMD Lite 方案（BM25-only，Phase 1）

不等到向量恢复再做。先走通 BM25 关键词召回，Memory Recall 闭环跑起来。
向量恢复后再做 QMD Adapter Full。

### ✅ 4. Runtime API Spec 前置（P0 第 4 位）

不与任何实现绑定，接口契约先锁死。`ObjectiveService / GoalService / TaskService / CheckpointService` 的输入输出和事件模型定死。

---

## 二、终极目标架构（MRX 2.0 完成后）

```
                    用户 Objective
                         │
              ┌──────────▼──────────┐
              │  Objective Engine   │  ← 自然语言 → Objective 结构
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Goal Engine        │  ← Goal 进度/依赖/状态
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Hybrid Planner     │  ← LLM 拆 Goal + 规则拆 Task
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Task DAG           │  ← 带依赖的任务图
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Execution Loop     │  ← OBSERVE→ANALYZE→PLAN→...
              └──────────┬──────────┘
                         │
        ┌────────────────┼────────────────────┐
        │                │                    │
  ┌─────▼─────┐  ┌──────▼──────┐  ┌──────────▼──────────┐
  │ Verifier  │  │  Recovery   │  │  Checkpoint Manager  │
  │ Chain     │  │  Engine V2  │  │  (基于 State Graph)   │
  └───────────┘  └─────────────┘  └─────────────────────┘
        │                │                    │
        └────────────────┼────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  State Graph        │  ← SQLite WAL，统一状态模型
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Memory Compiler    │  ← 执行记录 → 结构化知识
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  QMD Lite           │  ← BM25 索引 + 关键词召回
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Memory Recall      │  ← 任务开始 → 检索 → 注入上下文
              └──────────┬──────────┘
                         │
                    下一轮循环
```

**关键设计原则**：
- State Graph 是一切模块的底座，先建底座再建功能
- Memory Recall 是闭环，"只写不读"是当前最大短板
- All I/O 走 SQLite WAL，不再 `fs.writeFileSync` 全量刷盘

---

## 三、Phase-by-Phase 实施计划

---

### Phase 1: Objective Engine（P0，~1200 行）

**目标**：把当前的 `MissionConfig.objective: string[]` 升级为层次化 Objective 结构。

**当前状态**：
```typescript
// core/types.ts — 当前
objective: string[];  // 扁平字符串列表
```

**目标状态**：
```yaml
objective:
  id: obj_001
  title: "开发股票交易系统"
  description: "构建完整的量化交易平台"
  goals:
    - id: goal_01
      title: "行情数据模块"
      dependencies: []
    - id: goal_02
      title: "回测引擎"
      dependencies: [goal_01]
    - id: goal_03
      title: "交易执行模块"
      dependencies: [goal_01, goal_02]
    - id: goal_04
      title: "风控系统"
      dependencies: [goal_03]
```

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/objective/objective-engine.ts` | ~400 | Objective 解析、Goal 生成（LLM 调用）、验证 |
| `core/objective/objective-schema.ts` | ~200 | Objective/Goal 类型定义、校验 schema |
| `core/objective/objective-state.ts` | ~200 | Objective 进度追踪、状态管理 |
| `core/objective/objective-validator.ts` | ~150 | Goal 重复检测、循环依赖检测、完整性检查 |
| **修改** `core/types.ts` | +100 | 新增 ObjectiveConfig / GoalNode / ObjectiveState 类型 |
| **修改** `core/parser/mission-parser.ts` | +50 | 支持 objective DSL 新格式 |
| **小计** | **~1100** | |

**关键设计决策**：
- Objective Engine 本身调用 LLM 做 Goal 分解（复用现有 LlmClient 接口）
- 输出格式严格 JSON Schema 约束（不依赖 LLM 自由发挥）
- Goal Validator 是纯规则引擎（循环检测用拓扑排序、重复检测用余弦相似度阈值）

**依赖**：无新依赖，复用现有 `LlmClient` 接口。

---

### Phase 2: Goal Engine（P0，~1200 行）

**目标**：每个 Goal 独立追踪进度、状态和依赖关系。支持 `goal_progress` 查询。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/goal/goal-engine.ts` | ~400 | Goal 生命周期管理（create→run→complete→archive） |
| `core/goal/goal-tracker.ts` | ~300 | Goal 进度计算（子 Task 完成率）、状态聚合 |
| `core/goal/goal-graph.ts` | ~250 | Goal 间依赖关系图、拓扑排序、阻塞检测 |
| **修改** `core/types.ts` | +80 | GoalStatus / GoalProgress 等类型 |
| **修改** `core/runtime/loop-engine.ts` | +50 | 集成 Goal 进度更新 |
| **小计** | **~1080** | |

**Goal 状态机**：
```
PENDING → READY → RUNNING → COMPLETED
                  ↓
              BLOCKED（依赖未满足）
                  ↓
              FAILED → RETRYING → RUNNING
```

**进度计算逻辑**：
```
Goal.Progress = completedTaskCount / totalTaskCount
```

**依赖**：Phase 1 Objective Engine

---

### Phase 3: Hybrid Planner V2（P0，~1800 行）

**目标**：从"关键词匹配假 DAG"升级为真正的 LLM + 规则双层 Planner。

**当前状态**：
```typescript
// dag-planner.ts — 当前
const PATTERNS = [
  { keywords: ["测试"], tasks: [...] },  // 关键词匹配
  { keywords: ["迁移"], tasks: [...] },
];
// 无匹配 → buildGenericTask() → 三步通用任务
```

**目标架构**：
```
Objective
   ↓
Goal Generator（LLM）     ← 新增：LLM 拆 Goal
   ↓
Goal Validator（规则）     ← 新增：去重/循环检测/完整性
   ↓
Epic Generator（规则）     ← 新增：Goal → Epic
   ↓
Task Generator（规则）     ← 新增：Epic → Task
   ↓
DAG Builder（规则）        ← 现有：依赖图构建（保留）
```

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/planner/hierarchical-planner.ts` | ~350 | 门面：编排 Goal→Epic→Task 整个拆解流程 |
| `core/planner/goal-generator.ts` | ~250 | LLM prompt + schema 约束：Objective → Goal[] |
| `core/planner/goal-validator.ts` | ~200 | 规则校验：循环依赖、语义重复、完整性 |
| `core/planner/epic-generator.ts` | ~200 | 规则引擎：Goal → Epic[] 分解 |
| `core/planner/task-generator.ts` | ~250 | 规则引擎：Epic → Task[] 分解 |
| `core/planner/dag-builder.ts` | ~200 | 现有 buildDAG 逻辑抽离 + 增强（并行度分析） |
| `core/planner/prompts/goal-decomposition.md` | ~100 | Goal 拆解 prompt 模板 |
| **修改** `core/planner/dag-planner.ts` | - | 重构为向后兼容门面，委托给 HierarchicalPlanner |
| **修改** `core/types.ts` | +80 | EpicNode 等新类型 |
| **小计** | **~1630** | |

**LLM Prompt 设计要点**（Goal Generator）：

```
System: 你是软件架构师。给定工程目标，拆解为 3-7 个子目标。
每个子目标必须：独立可验证、有明确交付物、标注与其他目标的依赖关系。

输出严格 JSON：
{
  "goals": [
    {
      "id": "goal_01",
      "title": "...",
      "description": "...",
      "deliverable": "可独立运行的模块",
      "depends_on": [],
      "estimated_complexity": "medium"
    }
  ]
}

约束：
1. 最多 7 个 Goal
2. 每个 Goal 的 description 不超过 100 字
3. depends_on 只能引用已存在的 goal_id
4. 不得出现循环依赖
```

**规则校验点**（Goal Validator）：
1. 循环检测 → 拓扑排序 + 反向边检测
2. 语义重复 → Jaccard 相似度 > 0.7 视为重复
3. 完整性 → 所有 Goal 覆盖原始 Objective 语义
4. 可执行性 → 每个 Goal 有明确 deliverable

**依赖**：Phase 1 Objective Engine + Phase 2 Goal Engine

---

### Phase 4: Runtime API Spec（P0，~600 行）

**目标**：先定义接口契约，不实现全部。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `api/spec/objective-service.ts` | ~150 | ObjectiveService 接口 + 事件类型 |
| `api/spec/goal-service.ts` | ~100 | GoalService 接口 |
| `api/spec/task-service.ts` | ~100 | TaskService 接口 |
| `api/spec/checkpoint-service.ts` | ~80 | CheckpointService 接口 |
| `api/spec/event-types.ts` | ~120 | 统一事件类型定义（扩展 EventKind） |
| `api/spec/README.md` | ~80 | 接口契约文档 |
| **小计** | **~630** | |

**核心接口示例**：

```typescript
interface ObjectiveService {
  createObjective(input: CreateObjectiveInput): Promise<Objective>;
  getObjective(id: string): Promise<Objective | null>;
  listObjectives(filter?: ObjectiveFilter): Promise<Objective[]>;
  getProgress(id: string): Promise<ObjectiveProgress>;
  onEvent(id: string, handler: EventHandler): Unsubscribe;
}

interface GoalService {
  createGoal(objectiveId: string, input: CreateGoalInput): Promise<Goal>;
  getGoal(id: string): Promise<Goal | null>;
  getProgress(id: string): Promise<GoalProgress>;
  updateStatus(id: string, status: GoalStatus): Promise<void>;
}
```

**依赖**：无（纯接口定义，零实现依赖）

---

### Phase 5: State Graph（P0，~2200 行）

**目标**：替代 `state.yaml` + `fs.writeFileSync`，升级为 SQLite WAL。

**当前问题**：
```typescript
// state-manager.ts — 当前
save(): void {
  // 每次修改 → 全量 fs.writeFileSync → 100 次循环 = 100 次同步刷盘
  fs.writeFileSync(this.statePath, yamlStr, "utf-8");
}
// 锁机制 = 文件锁，进程异常退出 → 死锁
acquireLock(): boolean {
  fs.writeFileSync(this.lockFile, String(process.pid), "utf-8");
}
```

**目标方案**：SQLite WAL 作为唯一状态源 + YAML 仅用于 checkpoint 快照导出。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/state-graph/database.ts` | ~300 | SQLite 连接管理、WAL 模式、migration |
| `core/state-graph/schema.sql` | ~80 | 表结构定义（objectives/goals/tasks/missions/events） |
| `core/state-graph/objective-store.ts` | ~250 | Objective CRUD |
| `core/state-graph/goal-store.ts` | ~250 | Goal CRUD + 进度追踪 |
| `core/state-graph/task-store.ts` | ~250 | Task CRUD + 依赖关系 |
| `core/state-graph/mission-store.ts` | ~200 | Mission 生命周期管理 |
| `core/state-graph/event-store.ts` | ~200 | Event 写入 + 查询 |
| `core/state-graph/transaction-manager.ts` | ~150 | 事务封装 + Lease Lock 机制 |
| `core/state-graph/snapshot-exporter.ts` | ~150 | SQLite → YAML/JSON 导出（checkpoint 用途） |
| **修改** `core/state/state-manager.ts` | - | 重构为 StateGraph 的门面，保持向后兼容 |
| **小计** | **~2030** | |

**SQLite Schema 核心表**：

```sql
-- WAL 模式
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'created',
  progress REAL DEFAULT 0.0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  progress REAL DEFAULT 0.0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE goal_dependencies (
  goal_id TEXT REFERENCES goals(id),
  depends_on TEXT REFERENCES goals(id),
  PRIMARY KEY (goal_id, depends_on)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  goal_id TEXT REFERENCES goals(id),
  description TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE task_dependencies (
  task_id TEXT REFERENCES tasks(id),
  depends_on TEXT REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  mission_id TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  data TEXT -- JSON
);
```

**Lease Lock 机制**（替代文件锁）：
```typescript
// 基于 SQLite 的 lease lock，进程异常退出自动过期
class LeaseLock {
  async acquire(lockKey: string, ttlMs: number = 30000): Promise<boolean> {
    // INSERT OR REPLACE 尝试获取锁
    // 如果已有锁 + 未过期 → 返回 false
    // 如果已有锁 + 已过期 → 覆盖获取
  }
  async release(lockKey: string): Promise<void> { ... }
  // 心跳续约（长时间运行的任务）
  async heartbeat(lockKey: string): Promise<void> { ... }
}
```

**依赖**：无（独立基础设施），需要 `better-sqlite3` npm 包。

---

### Phase 6: Memory Recall Engine（P0，~900 行）

**目标**：补上"只写不读"的最大短板。任务开始时自动检索历史经验，注入执行上下文。

**当前状态**：
- Memory Compiler 写入 `memory/{missionId}/decisions.md` 等文件
- **没有任何读取路径**，编译完就躺在那

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/memory/recall-engine.ts` | ~400 | 召回主逻辑：任务→关键词提取→检索→排序→构建上下文 |
| `core/memory/keyword-extractor.ts` | ~150 | 从 Task 描述提取检索关键词 |
| `core/memory/context-builder.ts` | ~200 | 将检索结果注入执行上下文（system prompt 补充） |
| **修改** `core/runtime/loop-engine.ts` | +100 | 在 ANALYZE 阶段注入 Memory Recall |
| **修改** `core/types.ts` | +30 | MemoryContext 类型 |
| **小计** | **~880** | |

**召回流程**：

```
Task 开始
   ↓
提取关键词（KeywordExtractor）
   ↓
BM25 检索（QMD Lite）
   ↓  "jwt authentication redis token"
   ↓
候选记忆排序（按 relevance + freshness）
   ↓
构建上下文（ContextBuilder）
   ↓  "上次 JWT 项目使用 Redis 存储 refresh token..."
   ↓
注入 ANALYZE 阶段
   ↓
继续执行
```

**Recall Engine 接口**：

```typescript
interface RecallResult {
  decisions: MemoryEntry[];   // 相关决策
  failures: MemoryEntry[];    // 相关失败教训
  solutions: MemoryEntry[];   // 相关解决方案
  patterns: MemoryEntry[];    // 相关模式
  relevanceScore: number;
}

class RecallEngine {
  async recall(taskDescription: string, objectiveTitle: string): Promise<RecallResult>;
  async buildContext(recallResult: RecallResult): Promise<string>; // 纯文本注入 prompt
}
```

**依赖**：State Graph（读记忆存储）+ QMD Lite（BM25 检索）

---

### Phase 7: QMD Lite（P0，~500 行）

**目标**：基于现有 BM25-only QMD，提供关键词召回。

**不做什么**：
- ❌ 不建向量索引（node-llama-cpp 死锁未解）
- ❌ 不调 embedding API
- ✅ 只做 BM25 文本检索 + 简单 rerank

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/memory/qmd-lite-client.ts` | ~200 | 封装 QMD `search` 命令调用 |
| `core/memory/qmd-lite-ingest.ts` | ~150 | Memory Compiler 输出 → QMD 可检索格式 |
| `core/memory/qmd-lite-query.ts` | ~100 | 查询构造、结果解析 |
| **修改** `core/memory/memory-compiler.ts` | +30 | compile 后自动触发 QMD ingest |
| **小计** | **~480** | |

**QMD 集成方式**：
```typescript
// 直接调用 openclaw memory search（已配置 BM25-only）
class QmdLiteClient {
  async search(query: string, corpus: "memory" | "wiki" | "all" = "all"): Promise<SearchResult[]> {
    // 调用 memory_search tool → BM25 召回
  }
  async ingest(entries: MemoryEntry[]): Promise<void> {
    // 写入 MEMORY.md 或 memory/*.md，自动触发索引
  }
}
```

**依赖**：Memory Compiler 输出 → QMD 可检索格式

---

### Phase 8: Checkpoint Rollback（P1，~1500 行）

**目标**：基于 State Graph 实现真正的回滚能力（而非当前的文件快照方案）。

**当前状态**：CheckpointManager 创建 yaml 快照，只能列出/读取，**不能真正恢复状态**。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/checkpoint/checkpoint-v2.ts` | ~350 | 新 Checkpoint 管理器：基于 State Graph 创建快照 |
| `core/checkpoint/rollback-engine.ts` | ~300 | 回滚逻辑：恢复 state + task_tree + memory |
| `core/checkpoint/diff-engine.ts` | ~200 | Checkpoint 间差异对比 |
| `core/checkpoint/snapshot-strategy.ts` | ~200 | 快照策略：phase / interval / manual / on-failure |
| **修改** `core/runtime/loop-engine.ts` | +100 | ROLLBACK 裁决时真正执行状态恢复 |
| **废弃** `core/checkpoint/checkpoint.ts` | - | 被 checkpoint-v2.ts 替代 |
| **小计** | **~1150** | |

**核心能力**：

```typescript
class RollbackEngine {
  async rollback(missionId: string, checkpointId: string): Promise<RollbackResult> {
    // 1. 暂停当前 Mission
    // 2. 从 State Graph 恢复目标 checkpoint 的 state
    // 3. 恢复 task_tree（包括 status）
    // 4. 恢复 memory context
    // 5. 重建 event stream（标记 rollback 事件）
    // 6. 返回恢复结果
  }
  
  async listRollbackCandidates(missionId: string): Promise<Checkpoint[]>;
  async previewRollback(checkpointId: string): Promise<RollbackDiff>;
}
```

**依赖**：State Graph（Phase 5）

---

### Phase 9: Recovery Engine V2（P1，~1000 行）

**目标**：补完 README 里承诺但未实现的三个分支（rollback/alternative/skip）。

**当前状态**：只实现了 retry/replan/escalate 三条路径 + continue/complete。

**新增/修改文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| **重写** `core/recovery/recovery-engine.ts` | ~400 | 六分支完整决策树 |
| `core/recovery/alternative-strategist.ts` | ~200 | 失败后生成替代方案 |
| `core/recovery/skip-assessor.ts` | ~150 | 判断任务是否可安全跳过 |
| **修改** `core/runtime/loop-engine.ts` | +100 | 对接新增的 alternative/skip 分支 |
| **小计** | **~850** | |

**六分支决策树（升级版）**：

```
执行失败
   ├── RETRY       重试当前步骤（retryCount < maxRetries）
   ├── REPLAN      重新生成 DAG（方案根本错误）
   ├── ROLLBACK    回退到上一 checkpoint（状态已污染）
   ├── ALTERNATIVE 换一种实现方式（目标可达，路径错误）
   ├── SKIP        跳过当前任务（非关键路径，可降级）
   └── ESCALATE    暂停，请求人工介入（严重/接近上限）
```

**依赖**：State Graph + Checkpoint Rollback

---

### Phase 10: Verifier Chain（P1，~1500 行）

**目标**：验证从"跑命令"升级为三层验证链。

**当前状态**：`Validator.runAll()` 只跑 `npm test / npm build` 等命令。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/validator/verifier-chain.ts` | ~250 | 链式验证编排 |
| `core/validator/syntax-verifier.ts` | ~150 | TypeScript/Python 语法检查 |
| `core/validator/build-verifier.ts` | ~100 | 构建验证 |
| `core/validator/test-verifier.ts` | ~100 | 测试验证 |
| `core/validator/goal-verifier.ts` | ~300 | 目标级验证（DOM 变更/截图 diff/功能变更） |
| `core/validator/snapshot-comparator.ts` | ~200 | 前后截图/HTML 差异对比 |
| `core/validator/verifier-registry.ts` | ~150 | 验证器注册与发现 |
| **修改** `core/validator/validator.ts` | +50 | 改为门面，委托 VerifierChain |
| **小计** | **~1300** | |

**验证链结构**：
```
SyntaxVerifier  ──→ 语法无错误
       ↓
BuildVerifier   ──→ 构建成功
       ↓
TestVerifier    ──→ 测试通过
       ↓
GoalVerifier    ──→ 目标达成（如：页面确实变了）
```

**依赖**：Goal Engine（知道验证目标是什么）+ State Graph

---

### Phase 11: Supervisor V2（P2，~1200 行）

**目标**：从"风险审查 + 预算"升级为 Supervisor Council（多维度监督）。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `agents/supervisor/quality-manager.ts` | ~250 | 代码/文档质量评估 |
| `agents/supervisor/risk-manager.ts` | ~200 | 升级版风险评估（基于历史数据） |
| `agents/supervisor/budget-manager.ts` | ~200 | 实时预算追踪 + 动态调整 |
| `agents/supervisor/memory-manager.ts` | ~150 | 记忆质量评估（去重、衰减） |
| **修改** `agents/supervisor.ts` | - | 重构为 Council 门面 |
| **小计** | **~800** | |

**依赖**：Memory Recall + Verifier Chain

---

### Phase 12: Metrics Engine（P2，~800 行）

**目标**：统计仪表盘，`/mrx report` 命令。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `core/metrics/metrics-collector.ts` | ~200 | 指标采集 | 
| `core/metrics/metrics-reporter.ts` | ~200 | 报告生成 |
| `core/metrics/metrics-dashboard.ts` | ~200 | CLI 仪表盘 |
| `core/metrics/metrics-schema.ts` | ~100 | 指标类型定义 |
| **小计** | **~700** | |

**依赖**：State Graph（数据源）

---

### Phase 13: Runtime API 实现（P3，~1200 行）

**目标**：实现 Phase 4 定义的接口契约。

**新增文件**：

| 文件 | 行数 | 职责 |
|:---|:---|:---|
| `api/routes/objective-routes.ts` | ~200 | Objective CRUD |
| `api/routes/goal-routes.ts` | ~150 | Goal CRUD |
| `api/routes/task-routes.ts` | ~150 | Task CRUD |
| `api/routes/checkpoint-routes.ts` | ~100 | Checkpoint 操作 |
| `api/routes/mission-routes.ts` | ~150 | Mission 控制 |
| `api/server.ts` | ~250 | Express/Koa 服务 |
| `api/middleware/auth.ts` | ~80 | API Key 认证 |
| `api/middleware/validation.ts` | ~80 | 请求校验 |
| **小计** | **~1160** | |

**依赖**：所有核心模块完成后

---

## 四、开发顺序与依赖图

```
Phase 1: Objective Engine         ← 无依赖
   ↓
Phase 2: Goal Engine              ← 依赖 Phase 1
   ↓
Phase 3: Hybrid Planner V2        ← 依赖 Phase 1、2
   ↓
Phase 4: Runtime API Spec         ← 无依赖（接口定义）
   ↓
Phase 5: State Graph (SQLite)     ← 无依赖（基础设施）
   ↓
Phase 6: Memory Recall Engine     ← 依赖 Phase 5
   ↓
Phase 7: QMD Lite                 ← 依赖 Memory Compiler（已有）
   ↓
Phase 8: Checkpoint Rollback      ← 依赖 Phase 5
   ↓
Phase 9: Recovery Engine V2       ← 依赖 Phase 5、8
   ↓
Phase 10: Verifier Chain          ← 依赖 Phase 2、5
   ↓
Phase 11: Supervisor V2           ← 依赖 Phase 6、10
   ↓
Phase 12: Metrics Engine          ← 依赖 Phase 5
   ↓
Phase 13: Runtime API 实现        ← 依赖 Phase 1-12
```

## 五、工作量汇总

| 阶段 | 模块 | 优先级 | 新增/修改文件 | 预估行数 | 新增依赖 |
|:---|:---|:---|:---|:---|:---|
| P1 | Objective Engine | P0 | 5 | ~1100 | 无 |
| P2 | Goal Engine | P0 | 5 | ~1080 | better-sqlite3 |
| P3 | Hybrid Planner V2 | P0 | 9 | ~1630 | 无 |
| P4 | Runtime API Spec | P0 | 6 | ~630 | 无 |
| P5 | State Graph | P0 | 10 | ~2030 | better-sqlite3 |
| P6 | Memory Recall | P0 | 5 | ~880 | 无 |
| P7 | QMD Lite | P0 | 4 | ~480 | 无 |
| P8 | Checkpoint Rollback | P1 | 6 | ~1150 | ✅ 已完成 |
| P9 | Recovery V2 | P1 | 4 | ~850 | ✅ 已完成 |
| P10 | Verifier Chain | P1 | 8 | ~1300 | ✅ 已完成 |
| P11 | Supervisor V2 | P2 | 5 | ~800 | 无 |
| P12 | Metrics Engine | P2 | 4 | ~700 | 无 |
| P13 | Runtime API 实现 | P3 | 8 | ~1160 | express/koa |
| **合计** | | | **79** | **~13,790** | |

**基准线**：当前 3930 行 → 2.0 完成后约 13,790 行（含废弃/重构约 2000 行旧代码）

## 六、与现有设计提案的关系

`design/mission-runtime-proposal.md`（旺财 v2 版，2026-05-28）与本路线图互为补充：

| 维度 | 设计提案 | 本路线图 |
|:---|:---|:---|
| 定位 | 架构全景 + DSL 设计 | 可执行的重构计划 |
| 粒度 | 模块级架构 | 文件级 WBS |
| 基础设施 | SQLite + YAML 双写 | SQLite WAL 唯一源 + YAML 仅 export |
| Planner | DAG Planner | Hybrid Planner（LLM + 规则） |
| 记忆 | 五层记忆 + Qdrant | QMD Lite（BM25）→ 未来 QMD Full |
| API | SDK/CLI 预留 | API Spec 前置 + 接口契约先锁 |

**不冲突，互为工程阶段的上下篇**。

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|:---|:---|:---|
| QMD 向量检索长期不可用 | Memory Recall 精度受限 | BM25 + 人工标注关键词增强；同时监控 node-llama-cpp 修复进度 |
| State Graph SQLite 迁移破坏现有数据 | 历史 Mission 数据丢失 | 先做 yaml → sqlite 导入工具，新旧并存过渡 |
| Hybrid Planner LLM 结果不稳定 | Goal 拆解漂移 | Goal Validator 规则校验 + 结果缓存（同一 Objective 不重复拆） |
| better-sqlite3 编译问题（arm64） | 基础设施阻塞 | 备选：sql.js（纯 JS SQLite）作为 fallback |
| 代码量膨胀（当前 3.9K → 13.8K） | 维护负担增大 | 模块强隔离（每个 core/* 独立目录），单文件不超过 400 行 |
