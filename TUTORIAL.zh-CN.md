# MRX 使用教程 — 从零到自主智能体

> 手把手教你运行第一个 MRX 自主任务。

---

## 1. 安装

```bash
git clone https://github.com/zhbcher/openclaw-mrx.git
cd openclaw-mrx
npm install
```

验证安装：

```bash
npx tsc --noEmit                    # TypeScript 编译：零错误
npx tsx cli/mrx-skeleton.ts test     # 15 项测试全部通过
```

## 2. 第一个任务

### 2.1 创建任务配置文件（Mission DSL）

```yaml
# my-first-mission.yaml
version: 1

mission:
  id: hello-mrx
  name: "你好 MRX"
  description: "我的第一个自主任务"
  priority: medium

objective:
  - "展示 MRX 的自主规划和执行能力"

context:
  repo: "."            # 当前目录

constraints:
  - "不执行破坏性操作"

environment:
  working_dir: "."

validation:
  commands:
    - "ls -la"         # 验证文件存在
    - "echo '所有检查通过'"

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

### 2.2 通过命令行启动任务

```bash
# 快速开始 — 一句话创建目标并自动规划
npx tsx cli/mrx-skeleton.ts run "构建一个带回测引擎的股票交易系统"

# 预期输出：
# 🎯 创建 Objective: 构建一个带回测引擎的股票交易系统...
# 🧠 LLM 拆解 Goal...
#    生成了 4 个 Goal
# 🔍 Goal Validator 校验...
#    ✅ Goal 校验通过
# 💾 持久化到 State Graph (SQLite)...
#    ✅ 4 个 Goal 已写入数据库
```

### 2.3 查看任务状态

```bash
# 列出所有目标
npx tsx cli/mrx-skeleton.ts list

# 查看详细状态
npx tsx cli/mrx-skeleton.ts status <objective_id>

# 输出示例：
# 📊 Objective: 构建一个带回测引擎的股票交易系统
#    ID: obj_1717069200000
#    Status: running
#    Progress: 0%
#    Goals: 4
#
#    Goal 树：
#      🟢 goal_market_data: 行情数据模块 (ready)
#      ⏳ goal_backtest: 回测引擎 (pending) ← [goal_market_data]
#      ⏳ goal_trading: 交易执行模块 (pending) ← [goal_market_data, goal_backtest]
#      ⏳ goal_risk: 风控系统 (pending) ← [goal_trading]
```

## 3. Mission DSL 详解

Mission DSL 是 MRX 的核心配置。以下是每个字段的解释：

### 3.1 任务元数据

```yaml
mission:
  id: unique-mission-id          # 必填：唯一标识
  name: "人类可读的名称"          # 必填：显示名称
  description: "描述"            # 可选：详细描述
  priority: high                 # low | medium | high | critical
```

### 3.2 目标定义

```yaml
objective:
  - "主要目标描述"
  - "次要目标"
  - "第三个目标"
```

MRX 的混合规划器（Hybrid Planner）会将自然语言目标分解为带依赖关系的子目标 DAG，每个子目标都有明确的交付物、依赖关系和复杂度评估。

### 3.3 预算控制

```yaml
budget:
  max_tokens: 1_000_000          # 最大 Token 消耗
  max_duration_hours: 12         # 最大运行时长
  max_cost_usd: 50               # 最大费用
  max_iterations: 50             # 最大循环迭代次数
  max_failures_per_task: 3       # 单任务最大重试次数
  warning_threshold: 0.8         # 80% 时触发警告
```

预算守卫（Budget Guard）实时监控全部 4 个维度。达到 80% 时预警，达到 100% 时强制阻断。

### 3.4 验证规则

```yaml
validation:
  commands:
    - "npm test"                 # 运行测试
    - "npm run lint"             # 代码规范检查
    - "npm run build"            # 构建检查
    - "npx tsc --noEmit"         # 类型检查
```

**核心铁律**：MRX 绝不让 LLM 自己判断自己是否成功。所有验证都是外部命令——真实命令返回真实的通过/失败结果。

### 3.5 检查点与恢复

```yaml
checkpoint:
  enabled: true
  strategy: phase               # phase | interval | manual
  interval_minutes: 30          # interval 策略时使用

autonomy:
  retry_enabled: true           # 失败后重试
  self_healing: true            # 自动切换策略
  auto_continue: true           # 暂停后自动恢复
```

MRX 在每个循环阶段后创建基于 SQLite 的检查点。任务失败时的恢复决策树：

1. **重试（Retry）** — 临时性错误（网络超时、构建抖动）
2. **替代方案（Alternative）** — 同样目标，换个方法
3. **回滚（Rollback）** — 回到上一个检查点
4. **跳过（Skip）** — 非关键路径，继续前进
5. **升级（Escalate）** — 需要人工介入

### 3.6 安全策略

```yaml
risk_policy:
  require_approval:             # 需要确认的操作
    - rm_rf
    - database_migration
    - production_deploy
    - npm_publish
  block:                        # 永远禁止的操作
    - outside_working_dir       # 禁止访问工作区外的文件
```

## 4. 核心操作

### 4.1 目标管理

```bash
# 创建目标
npx tsx cli/mrx-skeleton.ts run "描述你的目标"

# 列出所有
npx tsx cli/mrx-skeleton.ts list

# 查看详情
npx tsx cli/mrx-skeleton.ts status <objective_id>
```

### 4.2 记忆检索

MRX 会记住过去的任务经验。执行新任务前，自动检索相关历史：

```bash
# 搜索记忆
npx tsx cli/mrx-skeleton.ts recall "JWT鉴权"

# 输出示例：
# 🧠 [本地+QMD] 找到 9 条相关记忆（失败:1 方案:1 决策:1 模式:0 知识:0）
#   🔝 Top: [solution] JWT refresh token 轮转方案 (83%)
```

混合召回引擎综合三种信号打分：
- **0.3 × BM25**（关键词匹配）
- **0.5 × Embedding**（语义向量相似度，通过 QMD）
- **0.2 × Recency**（越新的记忆权重越高）

### 4.3 REST API

启动 API 服务：

```bash
npx tsx test/p3-api-test.ts    # 启动在 3621 端口，自动运行 12 项端点测试
```

常用端点：

```bash
# 创建目标
curl -X POST http://localhost:3620/api/v1/objectives \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mrx-dev-key" \
  -d '{"title": "我的目标"}'

# 列出目标
curl http://localhost:3620/api/v1/objectives \
  -H "Authorization: Bearer mrx-dev-key"

# 查看进度
curl http://localhost:3620/api/v1/objectives/{id}/progress \
  -H "Authorization: Bearer mrx-dev-key"

# 暂停任务
curl -X POST http://localhost:3620/api/v1/missions/{id}/pause \
  -H "Authorization: Bearer mrx-dev-key"

# 回滚到检查点
curl -X POST http://localhost:3620/api/v1/missions/{id}/rollback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mrx-dev-key" \
  -d '{"checkpoint_id": "cp_..."}'

# 全局统计报告
curl http://localhost:3620/api/v1/reports/global \
  -H "Authorization: Bearer mrx-dev-key"
```

完整 API 参考：20 个端点，覆盖 7 个资源组。详见 `design/contracts/openapi.yaml`。

## 5. 任务模板

### 5.1 代码重构

```yaml
mission:
  id: refactor-to-typescript
  name: "TypeScript 迁移"
  description: "将项目从 JavaScript 迁移到 TypeScript"
  priority: high

objective:
  - "配置 TypeScript 编译环境"
  - "逐模块迁移代码"
  - "确保所有测试通过"

validation:
  commands:
    - "npx tsc --noEmit"
    - "npm test"
    - "npm run build"

budget:
  max_iterations: 50
  max_duration_hours: 12
```

### 5.2 安全审计

```yaml
mission:
  id: security-audit
  name: "依赖安全审计"
  priority: critical

objective:
  - "扫描依赖漏洞"
  - "修复高危问题"
  - "验证修复不破坏功能"

validation:
  commands:
    - "npm audit --audit-level=high"
    - "npm test"

risk_policy:
  require_approval:
    - npm_publish
```

### 5.3 性能优化

```yaml
mission:
  id: perf-optimize
  name: "API 响应时间优化"
  priority: high

objective:
  - "基准测试当前性能"
  - "定位瓶颈"
  - "实施优化方案"
  - "验证改进效果"

validation:
  commands:
    - "npm run benchmark"
    - "npm test"

budget:
  max_iterations: 30
  max_duration_hours: 6
```

## 6. 高级功能

### 6.1 DAG 并行执行

TaskScheduler 自动并行执行无依赖关系的任务：

```
Goal: 回测引擎
  ├── Task A: 设计架构        (无依赖，立即执行)
  ├── Task B: 搭建测试框架    (无依赖，与 A 并行执行)
  └── Task C: 实现引擎        (依赖 A、B — 等两者完成后执行)
```

### 6.2 失败学习

失败记忆库记录模式并持续学习：

```
第 1 次失败："npm install 时 ECONNREFUSED"
  → 记录：errorType=network, solution="使用镜像源"

第 2 次失败："npm install 时 ECONNREFUSED"  
  → 匹配到已有模式，自动应用："使用镜像源"
```

### 6.3 向量搜索

内置 SQLite 向量存储，支持余弦相似度检索：

```typescript
const store = new VectorStore();
store.insert({ id: "v1", content: "JWT 鉴权", embedding: [...], category: "memory" });

// 语义搜索：返回语义相似的内容
const results = store.search(queryEmbedding, "memory", 5);
```

## 7. 常见问题

### 故障排查

**"OpenClaw API 不可用"**
→ LLM API 未连接。MRX 会自动降级到模拟规划器输出用于测试。连接 OpenClaw Gateway 后可调用真实 LLM。

**"UNIQUE constraint failed"**
→ 重跑前清理测试数据：`rm -f data/mrx.db` 或使用 `cleanupTestData()`。

**测试在 API 测试处卡住**
→ 之前的测试可能占用 3621/3622 端口。清理残留进程：
```bash
lsof -ti:3621 -ti:3622 | xargs kill -9
```

### 调试技巧

启用详细日志：

```bash
# 设置 debug 日志级别
MRX_LOG_LEVEL=debug npx tsx cli/mrx-skeleton.ts run "..."
```

查看事件总线历史：

```typescript
const events = eventBus.queryEvents({
  kind: "TASK_FAILED",
  missionId: "my-mission",
  limit: 20,
});
```

---

## 速查表

| 命令 | 说明 |
|:---|:---|
| `npx tsx cli/mrx-skeleton.ts run "..."` | 创建目标并规划 |
| `npx tsx cli/mrx-skeleton.ts list` | 列出所有目标 |
| `npx tsx cli/mrx-skeleton.ts status <id>` | 查看目标详情和子目标 |
| `npx tsx cli/mrx-skeleton.ts recall "..."` | 搜索历史记忆 |
| `npx tsx cli/mrx-skeleton.ts test` | 运行全部测试 |
| `rm -f data/mrx.db` | 重置数据库 |
| `npx tsx test/p3-api-test.ts` | 启动 API 服务器 |

## 下一步

1. 阅读[架构设计文档](design/mission-runtime-proposal.md)
2. 查看[架构决策记录](design/adr/)
3. 查阅 [OpenAPI 规范](design/contracts/openapi.yaml)
4. 阅读[贡献指南](CONTRIBUTING.md)
