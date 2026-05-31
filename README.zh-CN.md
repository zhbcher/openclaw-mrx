# MRX — OpenClaw 任务运行时

> **自主智能体运行时。** 不是技能，不是脚本，是一个长期运行的任务执行引擎。
>
> 15 个阶段。65+ 个文件。~16,500 行代码。CI: ![CI](https://github.com/zhbcher/openclaw-mrx/actions/workflows/ci.yml/badge.svg) **55/55 项测试通过**。
>
> ECC 深度融合：63 个 Agent · 115 条规则 · 249 个技能 — [融合指南](DEEP-FUSION-GUIDE.md)
>
> 📖 [English Documentation](README.md) | 📚 [教程](TUTORIAL.zh-CN.md) | 📚 [English Tutorial](TUTORIAL.md)

MRX 将 AI 智能体从"一次性提示响应器"转变为**持久化自主执行器**，能够跨小时甚至跨天进行任务规划、执行、验证、恢复、记忆和报告。

---

## 快速开始

> 📚 **刚接触 MRX？** 读一遍[使用教程](TUTORIAL.zh-CN.md)即可上手。

```bash
# 安装
cd openclaw-mrx && npm install

# 运行全部测试（55 项）
npx tsx cli/mrx-skeleton.ts test      # 主套件：15 项
npx tsx test/v1-executor-test.ts      # V1：   12 项
npx tsx test/v2-integration-test.ts   # V2：   10 项
npx tsx test/p0-new-test.ts           # P0：    8 项
npx tsx test/deep-fusion-test.ts      # ECC：   5 项
npx tsx test/ecc-skill-executor-test.ts  # ECC： 5 项

# 创建 Objective 并规划
npx tsx cli/mrx-skeleton.ts run "开发股票交易系统"

# 查看状态
npx tsx cli/mrx-skeleton.ts status <objective_id>

# 检索记忆
npx tsx cli/mrx-skeleton.ts recall "JWT鉴权"

# 导出 MRX Agent 到 ECC/Claude Code 格式
npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export

# 启动 REST API
npx tsx test/p3-api-test.ts
```

---

## 架构总览（ECC 增强）

```
                    用户目标
                         │
              ┌──────────▼──────────┐
              │  Objective Engine   │  层次化目标管理
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Hybrid Planner     │  LLM 拆解 + 规则校验
              │  + ECC 知识注入      │  ECC: 63 个Agent · 115 条规则
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  执行循环            │  八阶段：观察→分析→计划→
              │  + Goal Engine       │  执行→验证→反思→裁决→检查点
              │  + ECC 注入          │  ECC 在 ANALYZE/PLAN/VALIDATE 注入
              └──────────┬──────────┘
                         │
        ┌────────────────┼───────────────────┬──────────────────┐
        │                │                   │                  │
  ┌─────▼─────┐  ┌──────▼──────┐  ┌─────────▼──────────┐  ┌───▼──────────┐
  │ Executor  │  │  Recovery   │  │  Checkpoint         │  │  ECC 层     │
  │ Registry  │  │  Engine V2  │  │  Manager V2         │  │  (7 模块)   │
  └───────────┘  └─────────────┘  └────────────────────┘  │            │
        │                                                   │RuleLoader │
  ┌─────▼─────┐  ┌──────────────┐  ┌──────────────────┐  │AgentAdapter│
  │ Command   │  │ File         │  │ ECCSkillExecutor │  │ECCVerifier│
  │ Executor  │  │ Executor     │  │ (249 ECC 技能)    │  │ShieldGate │
  └───────────┘  └──────────────┘  └──────────────────┘  └──────┬─────┘
                         │                                    │
              ┌──────────▼──────────┐                 ┌───────▼───────┐
              │  State Graph        │  SQLite WAL     │ ecc-assets/  │
              └──────────┬──────────┘                 │ 63 个 Agent  │
                         │                            │ 115 条规则   │
              ┌──────────▼──────────┐                 │ 249 个技能   │
              │  Memory Recall      │  BM25+Embedding │              │
              │  + ECC Context      │  + Recency      └───────────────┘
              └─────────────────────┘
```

## ECC 深度融合

MRX 集成了 **affaan-m/ECC**（182K+ stars，业界最大的 Agent Harness 开源系统），实现四层融合：

### 第一层 — 知识注入
Loop Engine 的 ANALYZE 和 PLAN 阶段自动检索 ECC 规则库并注入 LLM 上下文。

资产：**115 条规则**覆盖 20 种语言（TypeScript、Python、Go、Rust、Java、Kotlin、C++、Swift、Ruby、PHP、Angular、React、Web、C#、Dart、F#、Perl、ArkTS 及中文）。

### 第二层 — 专家 Agent 适配
63 个 ECC Agent prompt 被解析为可复用的 System Prompt，MRX 在执行任务时可按需"扮演"特定角色（安全审查、架构设计、代码审查等）。

### 第三层 — 质量门控
ECC 规则接入 MRX 的 VALIDATE 阶段：

| 门控 | 检查项 |
|:---|:---|
| 安全 | 硬编码密钥、eval()、innerHTML、命令注入 |
| 编码风格 | var 替代 const/let、== 替代 ===、console.log |
| 测试 | 缺失测试文件、缺失断言 |
| 性能 | 循环中的 await、forEach-async 反模式 |

### 第四层 — 技能执行器
249 个 ECC skill 可直接发现，~20 个有 Python/Shell 脚本的技能可执行。

### 第五层 — 安全与导出
- **AgentShieldGate**：内置模式匹配 + 可选 ecc-agentshield
- **跨 Harness 导出**：`npx tsx cli/export-ecc.ts` → ECC/Claude Code/Codex 格式

详见 [中文融合指南](DEEP-FUSION-GUIDE.md)（英文）或 [ECC-INTEGRATION.md](ECC-INTEGRATION.md)。

## 模块清单

| 模块 | 阶段 | 说明 |
|:---|:---|:---|
| `objective/objective-engine` | P0 | 目标生命周期管理 |
| `goal/goal-engine` | P0 | 目标状态机、依赖解析 |
| `planner/*` | P0 | 混合规划器（LLM + 规则）|
| `state-graph/*` | P0 | SQLite WAL 持久化 |
| `memory/*` | P0 | 关键词提取、召回、上下文构建 |
| `checkpoint/checkpoint-v2` | P1 | SQLite 检查点 + 回滚 |
| `recovery/recovery-engine-v2` | P1 | 6 分支恢复决策树 |
| `validator/verifier-chain` | P1 | 语法→构建→测试→目标验证链 |
| `supervisor/quality-manager` | P2 | 5 项质量检查 |
| `metrics/metrics-engine` | P2 | 任务+全局度量统计 |
| `api/*` | P3 | HTTP 服务 + 20 个 REST 端点 |
| `executor/*` | V1 | 4 种执行器：命令/文件/工具/**ECC 技能** |
| `budget/budget-guard` | V1 | 4 维预算防护 |
| **`ecc/*`** | **ECC** | **7 模块：规则加载/Agent适配/验证/安全门控** |

## 测试套件（55/55 ✅）

```bash
npx tsx cli/mrx-skeleton.ts test      # 主套件：15 项
npx tsx test/v1-executor-test.ts      # V1：   12 项
npx tsx test/v2-integration-test.ts   # V2：   10 项
npx tsx test/p0-new-test.ts           # P0：    8 项
npx tsx test/deep-fusion-test.ts      # ECC：   5 项
npx tsx test/ecc-skill-executor-test.ts  # ECC： 5 项
```

| 套件 | 数量 | 覆盖范围 |
|:---|:---:|:---|
| 主套件 | 15 | Objective→Goal→SQLite、检查点、恢复、验证链、API |
| V1 | 12 | 执行器、安全沙箱、预算防护 |
| V2 | 10 | 工具执行器、混合召回、语义验证 |
| P0 | 8 | DAG 调度、向量存储、故障记忆 |
| **ECC 深度融合** | **5** | **规则检索、Agent 匹配、上下文增强、验证** |
| **ECC 技能执行器** | **5** | **技能发现、canHandle、错误处理、列表、信息** |

## 设计文档

| 文档 | 说明 |
|:---|:---|
| `ARCHITECTURE-FREEZE.md` | 架构冻结契约 |
| `DEEP-FUSION-GUIDE.md` | ECC 融合集成指南 |
| `docs/adr/ADR-001~004` | 4 份架构决策记录 |
| `docs/mrx-2.0-optimized-roadmap.md` | 14 阶段 WBS 路线图 |
| `docs/contracts/openapi.yaml` | OpenAPI 3.1 规范（26 端点）|

## 阶段完成状态

```
✅ 架构冻结           (4 份契约 + 4 ADR + OpenAPI)
✅ P0: 核心运行时      (7/7 — Objective, Goal, Planner, StateGraph, Memory, QMD Lite)
✅ P1: 弹性恢复        (3/3 — 检查点回滚, 恢复引擎 V2, 验证链)
✅ P2: 质量监督        (2/2 — 质量管理器, 度量引擎)
✅ P3: 外部 API       (1/1 — REST API + zod + 认证)
✅ V1: 执行器          (5/5 — 4 种执行器 + 预算防护)
✅ V2: 智能增强        (4/4 — 工具执行器, 混合召回, 语义验证, 循环执行)
✅ P0-NEW: 规模化      (3/3 — DAG 调度, 向量存储, 故障记忆)
✅ ENGR: 工程化        (4/4 — 日志, 认证, CI/CD, 贡献指南)
✅ PERF: 性能优化      (4/4 — 缓存, Set 查找, 事件驱动, 防抖)
✅ ECC: 深度融合       (5/5 — 规则加载, Agent适配, 验证, 安全, 导出)
─────────────────────────────────────────────────────────
   全部阶段完成 · 55/55 项测试通过
```

## 许可证

MIT
