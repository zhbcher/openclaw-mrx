# OpenClaw Mission Runtime（MRX）完整架构设计

> 状态：提案阶段 v2 | 日期：2026-05-28 | 作者：旺财
> 
> 融合三份输入：① 四开源项目解剖 ② Mission Runtime 定位升级 ③ 完整 MRX 架构规划

---

## 〇、定位：不是 Skill，是 Agent OS

### 0.1 名字

**OpenClaw Mission Runtime，代号 MRX。**

不叫 Goal（太像 Codex），不叫 Task（太轻）。Mission 的语义是"完整工程任务系统"。

### 0.2 一句话定位

> "AI 不再是一次性回答器，而是持续推进目标的自治执行体。"

### 0.3 能力全景

```
传统 Agent： Prompt → 输出 → 结束

MRX Agent：   Mission → 持续执行 → 自主规划 → 自主验证 → 自主恢复 → 长期记忆 → 最终完成
```

| 能力 | 说明 |
|:---|:---|
| 长期运行 | 可连续工作数小时/数天 |
| 目标驱动 | 不依赖多轮 Prompt |
| 自主规划 | 自动拆解为任务 DAG |
| 自主执行 | 自动操作代码/文件/命令 |
| 自主验证 | 外部工具执行验证 |
| 自主恢复 | 失败后自动换方案/回滚 |
| 状态持久化 | 断点精确恢复 |
| 长期记忆 | 跨 Mission 工程经验沉淀 |
| 多 Agent 协作 | Builder/Auditor/Planner/Tester |
| 风险控制 | 四级风险分级 + 人工审批 |
| Sandbox 执行 | 安全运行环境 |
| HITL 模式 | 人类协作接口 |

---

## 一、Mission 生命周期（状态机）

### 1.1 正式状态机

```
CREATED
   │
   ▼
PLANNING ──────→ 生成任务 DAG
   │
   ▼
READY ────────→ 等待启动
   │
   ▼
┌──────────────────────────────────────┐
│           RUNNING                    │
│                                      │
│  OBSERVE → ANALYZE → PLAN →         │
│  EXECUTE → VALIDATE → REFLECT →     │
│  JUDGE → CHECKPOINT                  │
│                                      │
│  ┌─── 正常流 ──→ COMPLETED          │
│  │                                    │
│  └─── 失败流 ──→ FAILED              │
│       │                                │
│       ├→ RECOVERY → REPLAN → RUNNING │
│       ├→ ESCALATE（等人）             │
│       └→ ABORT → FAILED（终态）       │
└──────────────────────────────────────┘
   │
   ▼
COMPLETED → ARCHIVED（编译记忆后归档）
```

### 1.2 状态转换规则

| 当前状态 | 事件 | 下一状态 |
|:---|:---|:---|
| CREATED | mission 解析成功 | PLANNING |
| PLANNING | DAG 生成完成 | READY |
| READY | 用户启动 / 自动触发 | RUNNING |
| RUNNING | 所有 stop_when 条件满足 | COMPLETED |
| RUNNING | 验证失败 + 可自动修复 | RUNNING（RETRY 子状态） |
| RUNNING | 验证失败 + 不可自动修复 | FAILED |
| RUNNING | 用户暂停 | PAUSED |
| PAUSED | 用户恢复 | RUNNING |
| FAILED | 恢复策略成功 | RUNNING（REPLAN） |
| FAILED | 恢复策略耗尽 | FAILED（终态） |
| COMPLETED | 归档操作 | ARCHIVED |

---

## 二、核心架构全景

```
                              User
                               │
                     ┌─────────▼──────────┐
                     │   Mission Parser   │  ← mission.yaml
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐
                     │   DAG Planner      │  ← 目标 → 任务 DAG
                     └─────────┬──────────┘
                               │
              ┌────────────────▼────────────────┐
              │       Execution Loop             │
              │                                  │
              │  OBSERVE  ← 感知环境状态          │
              │     ↓                            │
              │  ANALYZE  ← 分析侦察结果          │
              │     ↓                            │
              │  PLAN     ← 生成本轮执行计划      │
              │     ↓                            │
              │  EXECUTE  ← 调用工具执行          │
              │     ↓                            │
              │  VALIDATE ← 外部工具验证          │
              │     ↓                            │
              │  REFLECT  ← 反思成败原因          │
              │     ↓                            │
              │  JUDGE    ← 裁决下一步流向        │
              │     ↓                            │
              │  CHECKPOINT ← 阶段快照            │
              └────────────────┬────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
  ┌─────▼─────┐    ┌───────────▼──────────┐   ┌──────▼──────┐
  │  State    │    │    Event Bus         │   │  Recovery   │
  │  Store    │    │  MISSION_STARTED     │   │  Engine     │
  │           │    │  TASK_COMPLETED      │   │             │
  │ SQLite    │    │  VALIDATION_FAILED   │   │ Retry       │
  │ + YAML    │    │  CHECKPOINT_CREATED  │   │ Replan      │
  │           │    │  RECOVERY_TRIGGERED  │   │ Rollback    │
  └───────────┘    └──────────────────────┘   │ Ask Human   │
                                              │ Abort       │
  ┌───────────┐    ┌──────────────────────┐   └─────────────┘
  │  Memory   │    │    Risk Engine        │
  │  System   │    │                       │
  │           │    │  LOW → 自动执行        │
  │ 5 层架构  │    │  MEDIUM → 记录        │
  │           │    │  HIGH → 请求确认       │
  └───────────┘    │  CRITICAL → 强制阻断   │
                   └───────────────────────┘
```

### 2.1 目录结构

```
openclaw-mrx/
├── core/
│   ├── runtime/          # 主循环引擎 + 状态机
│   ├── parser/           # mission.yaml → 内部结构
│   ├── planner/          # DAG Planner + Workflow Engine
│   ├── executor/         # 工具调用执行器
│   ├── validator/        # 外部验证路由器
│   ├── reflector/        # 反思与学习模块
│   ├── recovery/         # 恢复引擎（Retry/Replan/Rollback）
│   ├── checkpoint/       # 快照系统
│   ├── memory/           # Memory Compiler + 五层记忆
│   ├── risk/             # Risk Engine（四级风险）
│   ├── budget/           # Budget Controller
│   ├── eventbus/         # Event Bus（事件发布/订阅）
│   └── state/            # State Manager（state.yaml 读写）
│
├── agents/
│   ├── builder/          # 代码生成 Agent
│   ├── auditor/          # 风险审查 Agent
│   ├── planner/          # 任务规划 Agent
│   ├── tester/           # 测试执行 Agent
│   ├── reviewer/         # Code Review Agent
│   └── memory/           # 知识编译 Agent
│
├── missions/
│   ├── active/           # 进行中的 Mission（state.yaml + events）
│   ├── archived/         # 已归档 Mission
│   └── templates/        # Mission 模板（重构/迁移/安全审计等）
│
├── storage/
│   ├── checkpoints/      # checkpoint 快照
│   ├── events/           # 事件流审计日志
│   ├── logs/             # 运行日志
│   └── vectors/          # 向量记忆（Qdrant / 本地）
│
├── adapters/             # 平台适配层
│   ├── openclaw.ts       # OpenClaw 原生适配
│   ├── claude-code.ts    # Claude Code 适配（预留）
│   └── generic.ts        # 通用 CLI Agent 适配
│
├── tools/                # 工具注册与发现
├── prompts/              # Prompt 模板
├── policies/             # 风险策略配置
├── ui/                   # Mission Dashboard（Phase 4）
├── api/                  # REST API（Phase 4）
├── sdk/                  # SDK（供外部调用）
└── cli/                  # /mission 命令行
```

---

## 三、Mission DSL（mission.yaml）— 系统灵魂

```yaml
version: 1

mission:
  id: mission-payment-refactor
  name: "支付系统重构"
  description: "将支付模块从 Stripe v14 迁移到 v15，保持 API 兼容"
  priority: high

objective:
  - "将支付系统迁移到 Stripe v15"
  - "保持旧 API 向后兼容"
  - "所有测试通过"
  - "更新相关文档"

context:
  repo: "./payment-service"
  branch: "feature/stripe-v15"

constraints:
  - "不允许修改数据库 schema"
  - "不允许删除旧接口"
  - "必须兼容 Node 18"
  - "所有变更保持在 feature/stripe-v15 分支"

environment:
  working_dir: "./payment-service"
  shell: "zsh"
  node_version: "18"

validation:
  commands:
    - "npm test"
    - "npm run lint"
    - "npm run build"
    - "npx tsc --noEmit"
  e2e:                                    # 可选
    - "npm run integration-test"
  custom:
    - script: "./scripts/check-api-compat.sh"
      description: "检查 API 兼容性"

success_conditions:
  type: all_of
  conditions:
    - tests_passed
    - build_success
    - no_type_errors
    - lint_clean

budget:
  max_tokens: 10_000_000
  max_duration_hours: 12
  max_cost_usd: 50
  max_iterations: 50
  max_failures_per_task: 3
  warning_threshold: 0.8

checkpoint:
  enabled: true
  strategy: phase            # phase | interval | manual
  interval_minutes: 30       # only when strategy=interval

memory:
  enabled: true
  persist: true
  compile_after: true

risk_policy:
  require_approval:
    - rm_rf
    - database_migration
    - production_deploy
    - npm_publish
    - force_push
  block:
    - outside_working_dir     # 禁止操作 Mission 工作目录外的文件

human_interaction:
  mode: ask_when_blocked       # silent | notify | ask_when_blocked | always_ask
  notification:
    - escalate                 # 遇到需要人工决策时通知
    - checkpoint               # 每个 checkpoint 后通知
    - complete                 # 完成后通知

autonomy:
  retry_enabled: true
  self_healing: true
  auto_continue: true
```

**设计理由**：自然语言适合启动，但 DSL 解决三个问题——
① 验证条件必须可执行（不能靠 LLM 自我感动）
② 资源上限必须硬约束（防无限循环）
③ 约束条件必须结构化（防越界操作）

---

## 四、十大核心模块

### 4.1 OBSERVE（环境感知）

**AI 必须先理解当前世界状态，再动手。**

```
感知维度：

  Repo 结构  ← 文件树、模块依赖
  Git 状态   ← 当前分支、未提交变更、diff
  编译状态   ← tsc/build 是否通过
  测试状态   ← 哪些测试通过/失败
  依赖版本   ← package.json / requirements.txt
  系统资源   ← CPU/内存/磁盘
  运行日志   ← 最近的错误日志
  历史记忆   ← 本项目之前的 Mission 经验
```

**输出**：环境报告（结构化 JSON），作为 ANALYZE 的输入。

### 4.2 Workflow Engine（DAG 任务引擎）

**任务不能线性。必须支持依赖、并行、动态插入。**

任务结构：
```json
{
  "id": "task-003",
  "description": "Stripe SDK 升级",
  "depends_on": ["task-001"],
  "children": [],
  "status": "pending",
  "retry_count": 0,
  "max_retries": 3,
  "assigned_agent": "builder"
}
```

任务状态机：
```
PENDING ──→ READY ──→ RUNNING ──→ DONE
               │           │
               │           ├──→ FAILED ──→ RETRYING ──→ RUNNING
               │           │                    │
               │           │                    └──→ BLOCKED（等人）
               │           │
               └──→ BLOCKED（依赖未满足）
```

**核心能力**：
- 自动识别任务间的并行/串行关系
- 子任务失败不阻塞兄弟节点（无依赖的）
- 动态插入新任务（执行中发现遗漏）
- DAG 本身可被 checkpoint 快照

### 4.3 Execution Loop（自主循环 — 系统灵魂）

```
┌──────────────────────────────────────────────────────┐
│                LOOP ITERATION                         │
│                                                       │
│  OBSERVE ──→ ANALYZE ──→ PLAN ──→ EXECUTE            │
│                                          │            │
│                                          ▼            │
│                                       VALIDATE        │
│                                          │            │
│                          ┌───────────────┤            │
│                          ▼               ▼            │
│                       REFLECT          JUDGE          │
│                          │               │            │
│                          └───→ CHECKPOINT ←───────────┘
└──────────────────────────────────────────────────────┘
```

| 阶段 | 职责 | 输入 | 输出 |
|:---|:---|:---|:---|
| **OBSERVE** | 感知当前环境状态 | 文件系统 + git + 运行环境 | 环境报告 |
| **ANALYZE** | 分析侦察结果，识别问题 | 环境报告 + 任务 DAG | 分析结论（哪些变了、哪些有问题） |
| **PLAN** | 生成本轮执行计划 | 分析结论 + 任务 DAG | 本次要执行的具体步骤列表 |
| **EXECUTE** | 调用工具执行计划 | 步骤列表 | 执行结果（代码变更、命令输出等） |
| **VALIDATE** | 外部工具验证结果 | 执行结果 + validation 定义 | 通过/失败 + 失败详情 |
| **REFLECT** | 反思本轮成败原因 | 完整循环记录 | 反思笔记 → 写入 memory/ |
| **JUDGE** | 裁决下一步流向 | 验证结果 + stop_when 条件 | continue / retry / replan / rollback / escalate / complete |
| **CHECKPOINT** | 创建阶段快照 | state.yaml + DAG | 快照文件 |

### 4.4 Executor（执行器 — 工具总线）

```
EXECUTOR 调用的工具矩阵：

  文件操作    → write / read / edit / patch
  AST 操作    → 结构化代码修改
  Shell 命令  → exec（带 sandbox 限制）
  Git 操作    → commit / branch / diff / log
  代码搜索    → grep / ripgrep / ast-grep
  HTTP 调用   → web_fetch（API 测试）
  浏览器      → browser（E2E 测试）
  测试运行    → npm test / pytest / cargo test
```

### 4.5 Validator（外部验证 — 绝不自我感动）

**核心铁律：LLM 不能自己判断自己是否成功。**

```
验证器架构：

mission.yaml validation 定义
        │
        ▼
┌───────────────────┐
│  Validator Router │  ← 根据命令类型分发
└───────┬───────────┘
        │
  ┌─────┼─────┬──────────┬──────────┐
  ▼     ▼     ▼          ▼          ▼
npm   tsc   curl      playwright   lint
test  check API       e2e         doc
```

**验证结果**写入 state.yaml，作为 JUDGE 的唯一输入——不允许 Executor 或 Planner 绕过 Validator 直接声明"完成了"。

### 4.6 Recovery Engine（恢复引擎）

```
失败后的恢复树：

                    执行失败
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      RETRY         REPLAN         ROLLBACK
   重试当前步骤    重新规划方案    回退到上一 checkpoint
        │              │              │
        ├─ 成功 → 继续  ├─ 成功 → 继续  └─→ 从快照恢复，换方案
        │              │
        └─ 再失败 ──→ 判断重试次数
                       │
              ┌────────┴────────┐
              ▼                 ▼
         换策略重试          ASK HUMAN
       (Alternative)      (向用户报告)
              │                 │
              └─ 再失败 ──→   ABORT（终态）
```

### 4.7 Checkpoint System（快照系统）

**不做 checkpoint 的 Agent 是薛定谔的 Agent。**

每次 checkpoint 保存：
```
checkpoints/mission-payment-refactor/
├── cp_001_init/
│   ├── state_snapshot.yaml      # 当前状态完整快照
│   ├── task_dag_snapshot.yaml   # 任务 DAG 状态
│   ├── context_summary.md       # 关键决策 + 失败记录
│   ├── current_diff.patch       # 当前变更
│   └── memory_snapshot/         # 当前记忆快照
├── cp_002_api_layer_done/
│   └── ...
└── cp_003_db_layer_done/
    └── ...
```

**触发策略**：phase（DAG 节点完成）/ interval（定时）/ manual（用户手动）

**恢复**：`/mission resume` → 读最新 checkpoint → 从断点精确继续

### 4.8 Memory System（五层记忆 — OpenClaw 最大优势）

| 层 | 用途 | 生命周期 | 存储 |
|:---|:---|:---|:---|
| **Working Memory** | 当前循环的上下文 | 单次循环 | 内存 |
| **Episodic Memory** | 历史步骤记录（events/） | 当前 Mission | JSON/JSONL |
| **Semantic Memory** | 项目知识（架构、约定、技术栈） | 跨 Mission | Markdown + 向量 |
| **Procedural Memory** | 修复套路（"这类问题怎么修"） | 跨项目 | Markdown + 向量 |
| **Long-term Memory** | 长期工程经验 | 永久 | MEMORY.md + Qdrant |

**Memory Compiler**：
```
Mission 执行过程
       │
       ▼
┌──────────────────┐
│  Memory Compiler │  ← 在执行过程中和完成后自动触发
└──────┬───────────┘
       │
       ├──→ decisions/    ← "为什么选方案 A 而不是 B"
       ├──→ failures/     ← "尝试过 X 失败，根因是 Y，修复是 Z"
       ├──→ solutions/    ← "这类问题的通用解法"
       ├──→ experiments/  ← "试过但不确定对错的探索"
       └──→ knowledge/    ← "项目技术栈、架构约定、踩坑记录"
```

### 4.9 Risk Engine（四级风险分级）

| 风险等级 | 动作 | 示例 |
|:---|:---|:---|
| **LOW** | 自动执行 | 读文件、运行测试、代码搜索 |
| **MEDIUM** | 自动执行 + 记录 | 修改代码、新建文件、git commit |
| **HIGH** | 请求用户确认 | 删除文件、修改依赖、git push |
| **CRITICAL** | 强制阻断 | `rm -rf`、数据库迁移、生产部署、密钥修改 |

**规则配置**：
```yaml
risk_rules:
  - pattern: "rm -rf|rm -r"
    level: CRITICAL
    message: "检测到危险删除操作"

  - pattern: "DROP TABLE|DELETE FROM|ALTER TABLE"
    level: CRITICAL
    message: "检测到数据库破坏性操作"

  - pattern: "git push.*main|git push.*master"
    level: HIGH
    message: "检测到向主分支推送"

  - pattern: "npm publish|cargo publish"
    level: HIGH
    message: "检测到发布操作"

  - scope: "outside_working_dir"
    level: CRITICAL
    message: "操作超出 Mission 工作目录"
```

### 4.10 Event Bus（事件总线 — 系统可观测性）

```
事件类型：

  MISSION_STARTED        ← Mission 开始执行
  MISSION_PAUSED         ← 用户暂停
  MISSION_RESUMED        ← 从暂停/断点恢复
  MISSION_COMPLETED      ← 所有条件满足
  MISSION_FAILED         ← 无法自动恢复，终态失败
  MISSION_ARCHIVED       ← 已归档

  DAG_GENERATED          ← Planner 生成 DAG
  TASK_STARTED           ← 单个任务开始
  TASK_COMPLETED         ← 单个任务完成
  TASK_FAILED            ← 单个任务失败
  TASK_RETRYING          ← 任务重试
  TASK_BLOCKED           ← 任务阻塞（等人/等依赖）

  LOOP_ITERATION_START   ← 一轮循环开始
  LOOP_ITERATION_END     ← 一轮循环结束

  VALIDATION_PASSED      ← 验证通过
  VALIDATION_FAILED      ← 验证失败

  RECOVERY_TRIGGERED     ← 触发恢复
  RECOVERY_SUCCESS       ← 恢复成功
  RECOVERY_EXHAUSTED     ← 恢复策略耗尽

  BUDGET_WARNING         ← 预算使用超过阈值
  BUDGET_EXCEEDED        ← 预算超限

  RISK_APPROVAL_REQUIRED ← 需要人工审批
  RISK_APPROVAL_GRANTED  ← 审批通过
  RISK_BLOCKED           ← 已被风险引擎阻断
```

**设计意图**：整个系统完全可观测。出问题时翻 events/ 能精确回溯每一步。

---

## 五、数据存储方案

| 数据 | 存储 | 理由 |
|:---|:---|:---|
| Mission 元数据 | YAML 文件 | 人类可读，手动介入友好 |
| 运行时状态（state.yaml） | YAML 文件 | GoalBuddy 验证过的模式 |
| 任务 DAG | YAML + 内存 | 执行时在内存，checkpoint 时落盘 |
| Checkpoint 快照 | 文件系统 | 完整上下文，便于人工检查 |
| 事件流审计（events/） | JSONL | 追加写，顺序读，高效 |
| 结构化记忆 | Markdown + 向量 | OpenClaw 已有 QMD 检索 |
| 运行日志 | JSONL | 结构化可查询 |
| 长期知识库 | Qdrant + Markdown | 向量 + 全文双路检索 |

**为什么不用全套 SQLite**：Mission 的中断恢复场景需要直接读文件（不依赖数据库服务），YAML 文件天然适合。SQLite 留给 Phase 4 的多 Mission 并行调度层。

---

## 六、与四开源项目的基因溯源

| 模块 | 借鉴来源 | 改进 |
|:---|:---|:---|
| 目标 DSL | 全部四个项目都有"目标定义文件"概念 | MRX 的 mission.yaml 更结构化，五种预算约束 + 四级风险 + HITL 模式 |
| DAG Planner | GoalBuddy 的 scout/judge/worker | 升级为完整 DAG 引擎，支持并行 + 动态插入 + 状态机 |
| 执行循环 | Autoloop 指标驱动 + Autoresearch 三阶段 | 扩展为 8 阶段（OBSERVE→ANALYZE→PLAN→EXECUTE→VALIDATE→REFLECT→JUDGE→CHECKPOINT） |
| 状态持久化 | GoalBuddy 的 state.yaml | 增加 events/ 事件流，状态与历史分离 |
| Checkpoint | 自研（四项目都没做好这个） | 完整上下文快照（state + DAG + diff + memory + context） |
| 记忆系统 | OpenHands 的 Memory 模块思路 | 五层分层架构，跨 Mission 可检索，自动编译 |
| 事件审计 | SPM v3.2 的 EventStore | MRX 事件种类更丰富（20+ 事件类型），JSONL 格式 |
| 平台适配 | jcode 的经验教训 | 适配器模式，核心引擎不绑定任何平台 |
| 多 Agent | MetaGPT 多 Agent 协作思路 | Builder/Auditor/Planner/Tester/Reviewer 角色分工 |

---

## 七、MVP 实施路线

### Phase 1：最小可行循环（2-3 天）

**目标**：mission.yaml → 单任务线性执行 → state.yaml → 可中断恢复

```
实现清单：
✅ Mission DSL 解析器（mission.yaml → 内部结构）
✅ state.yaml 状态管理器（读写、锁）
✅ 核心循环（OBSERVE → ANALYZE → PLAN → EXECUTE → VALIDATE → JUDGE）
✅ 简单 Validator（command + expected 模式）
✅ Checkpoint 基础版（phase 策略）
✅ 中断恢复（启动时检测 state.yaml 断点续传）
```

**Phase 1 砍掉的**：DAG 并行、REFLECT、Memory Compiler、Event Bus、Supervisor Agent、Recovery Tree

### Phase 2：智能拆解与恢复（2-3 天）

```
✅ DAG Planner（LLM 驱动，自然语言 → 任务 DAG）
✅ REFLECT 反思阶段
✅ Recovery Engine（Retry / Replan / Rollback / Ask Human）
✅ JUDGE 多路径裁决（5 种流向）
✅ Event Bus 基础事件（MISSION_STARTED/COMPLETED/FAILED, TASK_*）
```

### Phase 3：记忆与风控（3-4 天）

```
✅ Memory Compiler（执行过程 → 结构化知识）
✅ 五层记忆架构
✅ Risk Engine（四级风险 + 规则引擎）
✅ Budget Controller
✅ Supervisor Agent（Auditor 审查）
✅ 适配器层
```

### Phase 4a: 多 Mission 调度 + REST API ✅ (2026-05-28)

```
✅ SQLite MissionRegistry（注册、查询、过滤、进度追踪）
✅ MissionScheduler（优先级并发调度、优雅关闭）
✅ REST API Server（9 端点 + SSE 事件流）
✅ CLI `mrx api` 命令
```

### Phase 4b: UI Dashboard + Self-evolution ⬜（远期）

```
✅ 多 Mission 并行调度
✅ Event Bus 完整事件体系
✅ UI Dashboard（Mission 状态、DAG 可视化、Token 消耗、Checkpoint 时间线）
✅ REST API
✅ SDK
✅ 完整 CLI 命令集
✅ Strategy Switching（失败太多自动换方案）
✅ Self-Evolution（自动总结"这类 Bug 以后怎么修"）
✅ Project Brain（整个 Repo 的长期知识图谱）
```

---

## 八、CLI 命令

```bash
# 创建
/mission create "重构支付模块" --from mission.yaml
/mission create "修复所有 TS 类型错误" --auto

# 状态
/mission status
/mission status --detail
/mission log
/mission events                    # 查看事件流

# 控制
/mission start --id xxx
/mission pause
/mission resume
/mission resume --id xxx
/mission checkpoint                # 手动快照
/mission abort                     # 放弃当前 Mission

# 审查
/mission review                    # 执行报告
/mission review --checkpoint cp_003

# 归档
/mission archive
/mission archive --keep-checkpoints

# 列表
/mission list
/mission list --status active
/mission list --status archived

# 记忆
/mission memory --mission xxx      # 查看某 Mission 产生的记忆
/mission knowledge "Stripe SDK"    # 跨 Mission 搜索知识
```

---

## 九、与 OpenClaw 现有能力的集成

| OpenClaw 能力 | 集成方式 |
|:---|:---|
| **SPM v3.2 事件流** | MRX events/ 直接复用 EventStore 格式 |
| **Memory 系统** | 五层记忆兼容 MEMORY.md + QMD 检索 |
| **Multi-Agent 路由** | Supervisor Agent 通过 sessions_spawn 启动子 Agent |
| **飞书通知** | ESCALATE / CHECKPOINT / COMPLETE 时自动推送 |
| **Cron 调度** | Mission 可挂载 cron，定时检查/触发 |
| **PentoVideo 模板系统** | Mission 报告可渲染为 Dashboard |
| **风险规则** | 复用 2026-05-21 建立的平台合规铁律经验 |

---

## 十、风险与已知陷阱

1. **LOOP 死循环**：JUDGE 必须有 max_iterations 硬上限，到达即 ESCALATE
2. **LLM 自我验证偏差**：VALIDATE 只走外部命令，禁止 LLM 自评
3. **状态文件膨胀**：events/ 需自动轮转，Mission 归档时合并压缩
4. **并发安全**：state.yaml 需要锁机制（Phase 4 多 Mission 时必须解决）
5. **范围蠕变**：JUDGE 阶段做"目标偏离检测"，当前执行是否仍在解决原始 objective
6. **成本失控**：Budget Controller + warning_threshold 必须在 Phase 1 就实现基础版

---

## 十一、下一步

1. **Phase 1 MVP**，用 `stockpulse` 的 TypeScript 迁移作为第一个测试用例
2. Phase 1 完成后确认循环体验，再决定 Phase 2-4 优先级
3. 不急着做适配器层——先用 OpenClaw 原生跑通
