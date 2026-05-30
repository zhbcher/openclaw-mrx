# Contributing to MRX

## 快速开始

```bash
git clone https://github.com/zhbcher/openclaw-mrx.git
cd openclaw-mrx
npm install
```

## 本地开发

```bash
# TypeScript 编译检查
npx tsc --noEmit

# 运行全部测试（15 项）
npx tsx cli/mrx-skeleton.ts test

# V1 专项测试（Executor + Security）
npx tsx test/v1-executor-test.ts

# V2 专项测试（Tool + Hybrid Recall + Semantic）
npx tsx test/v2-integration-test.ts

# P0 专项测试（DAG Scheduler + Vector Store + Failure Memory）
npx tsx test/p0-new-test.ts

# 编译
npm run build
```

## 项目结构

```
openclaw-mrx/
├── core/              # 核心运行时
│   ├── runtime/       # Loop Engine（8-phase 主循环）
│   ├── objective/     # Objective Engine
│   ├── goal/          # Goal Engine
│   ├── planner/       # Hybrid Planner（LLM + 规则）
│   ├── executor/      # Executor Registry + Command/File/Tool
│   ├── scheduler/     # DAG 并发调度器
│   ├── recovery/      # Recovery Engine V2 + Failure Memory
│   ├── checkpoint/    # Checkpoint Manager V2
│   ├── validator/     # Verifier Chain（3-layer）
│   ├── memory/        # Hybrid Recall + Vector Store + QMD Lite
│   ├── state-graph/   # SQLite WAL Stores
│   ├── metrics/       # Metrics Engine
│   ├── budget/        # Budget Guard
│   └── config.ts      # 统一配置
├── api/               # REST API
│   ├── server.ts      # HTTP Server
│   ├── routes.ts      # 20 端点
│   ├── validators/    # Zod schemas
│   └── middleware/     # Auth
├── agents/            # Agent 层
│   └── supervisor/    # Supervisor Agent + Quality Manager
├── cli/               # CLI 入口
├── test/              # 测试套件（5 个文件）
└── design/            # 设计文档（workspace 内）
```

## 代码规范

- **TypeScript strict mode**：所有类型必须明确，避免 `any`
- **模块命名**：新模块放在 `core/<category>/`，文件名用 kebab-case
- **导入路径**：使用 `.js` 扩展名（ESM 要求）
- **接口优先**：先定义接口，再实现
- **方法长度**：单个方法不超过 60 行

## 提交流程

1. Fork 仓库，创建 feature 分支
2. 代码修改 + 确保 `npx tsc --noEmit` 零错误
3. 运行全部测试套件，确认 15/15 通过
4. 提交 PR，描述变更内容和测试结果
5. CI 自动运行 Type check + 4 test suites

## 提交信息格式

```
<type>: <简短描述>

## 变更说明
- 具体改动 1
- 具体改动 2

测试: XX/XX ✅
```

类型：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`

## 测试

- 修改核心模块后必须运行 `npx tsx cli/mrx-skeleton.ts test`
- 新增功能需要对应测试
- 测试文件命名：`test/<feature>-test.ts`
- 测试入口：自包含的 `main()` 异步函数，通过 `npx tsx` 直接运行

## Mission 模板

### 基础模板

```yaml
# mission.yaml
version: 1
mission:
  id: my-mission
  name: "项目名称"
  description: "项目描述"
  priority: medium

objective:
  - "项目目标描述"

context:
  repo: "./my-project"

constraints:
  - "约束条件"

budget:
  max_tokens: 1000000
  max_duration_hours: 2
  max_iterations: 30
  max_failures_per_task: 3

validation:
  commands:
    - "npm test"
    - "npm run lint"
    - "npm run build"

checkpoint:
  enabled: true
  strategy: phase

autonomy:
  retry_enabled: true
  self_healing: true
  auto_continue: true
```

### 代码重构模板

```yaml
mission:
  id: refactor-migration
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

## 获取帮助

- 设计文档：`design/` 目录
- 架构决策：`design/adr/`
- API 文档：`design/contracts/openapi.yaml`
- Issue 追踪：GitHub Issues
