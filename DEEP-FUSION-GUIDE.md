# MRX + ECC 深度融合指南

## 概述

这是 MRX 与 ECC 的**深度融合版本**，不同于简单的脚本执行集成。

**核心理念**：将 ECC 从「外部工具」提升为 MRX 的「核心知识库」和「行为准则」。

## 架构设计

### 1. ECC 知识注入层 (Knowledge Injection Layer)

**文件**：`core/ecc/rule-loader.ts`, `context-enricher.ts`, `ecc-context-builder.ts`

**功能**：
- 自动扫描 `ecc-assets/rules/` 和 `ecc-assets/agents/`
- 根据任务关键词动态加载相关规则
- 将 ECC 规则注入到 MRX 的执行上下文中

**使用示例**：

```typescript
import { ECCContextBuilder } from "./core/ecc/index.js";

const builder = new ECCContextBuilder();
await builder.initialize();

// 为 TypeScript 安全审查任务构建增强上下文
const context = await builder.buildEnhancedContext(
  baseContext,
  "Review TypeScript code for security issues",
  ["typescript", "security", "review"]
);

console.log(context.text); // 包含 ECC 规则和代理指导
```

### 2. ECC 角色适配层 (Role Adaptation Layer)

**文件**：`core/ecc/agent-adapter.ts`

**功能**：
- 将 ECC Agent 定义转换为 MRX 的执行角色
- 在执行任务时「化身」为特定的专业 Agent（如 `typescript-reviewer`）
- 自动提取 Agent 的防御基线、审查优先级和诊断命令

**使用示例**：

```typescript
import { ECCAgentAdapter, getECCRuleLoader } from "./core/ecc/index.js";

const loader = getECCRuleLoader();
await loader.initialize();

const adapter = new ECCAgentAdapter(loader);

// 根据任务关键词选择合适的 Agent
const agent = adapter.selectAgent(["typescript", "review"]);

// 为 Agent 构建执行上下文
const context = adapter.buildAgentContext(agent);

// 生成完整的 System Prompt
const systemPrompt = adapter.generateSystemPrompt(agent);

// 获取诊断命令
const diagnostics = adapter.getDiagnosticCommands(agent);

// 获取审查优先级
const priorities = adapter.getReviewPriorities(agent);
```

### 3. ECC 验证增强层 (Verification Enhancement Layer)

**文件**：`core/ecc/ecc-verifier.ts`

**功能**：
- 基于 ECC 规则进行代码审计
- 检查安全、编码风格、测试、性能等方面
- 返回详细的违规、警告和建议

**使用示例**：

```typescript
import { ECCVerifier } from "./core/ecc/index.js";

const verifier = new ECCVerifier(loader);

// 验证代码
const result = await verifier.verify(
  codeContent,
  "typescript",
  "review"
);

console.log(`通过: ${result.passed}`);
console.log(`违规: ${result.violations}`);
console.log(`警告: ${result.warnings}`);
console.log(`建议: ${result.suggestions}`);
console.log(`严重程度: ${result.severity}`);
```

## 集成点

### MRX LoopEngine 中的集成

在 `core/runtime/loop-engine.ts` 的 `ANALYZE` 阶段：

```typescript
// 在分析阶段，使用 ECC 增强上下文
const eccBuilder = new ECCContextBuilder();
await eccBuilder.initialize();

const keywords = this.extractKeywords(analysis);
const enhancedContext = await eccBuilder.buildEnhancedContext(
  baseContext,
  currentTask.description,
  keywords
);

// 将增强的上下文注入到 LLM 提示中
const systemPrompt = `${baseSystemPrompt}\n\n${enhancedContext.text}`;
```

### MRX VerifierChain 中的集成

在 `core/validator/verifier-chain.ts` 中添加 ECC 验证器：

```typescript
const eccVerifier = new ECCVerifier(loader);

// 在验证链中添加 ECC 验证
const verifierChain = new VerifierChain()
  .add(new SyntaxVerifier())
  .add(new BuildVerifier())
  .add(new TestVerifier())
  .add(eccVerifier); // 添加 ECC 验证
```

## 核心模块

### ECCRuleLoader

负责加载和索引 ECC 规则库。

**主要方法**：
- `initialize()` - 初始化加载器
- `getRulesByKeywords(keywords)` - 根据关键词检索规则
- `getRulesByLanguage(language)` - 获取特定语言的规则
- `getAgent(agentId)` - 获取特定代理
- `matchAgent(keywords)` - 根据关键词匹配代理
- `listAgents()` - 列出所有代理
- `listRules()` - 列出所有规则

### ECCContextEnricher

增强 MRX 的执行上下文。

**主要方法**：
- `enrichContext(baseContext, taskDescription, keywords)` - 增强上下文
- `buildLanguageRuleSet(language)` - 为特定语言构建规则集

### ECCContextBuilder

整合 RuleLoader 和 ContextEnricher。

**主要方法**：
- `initialize()` - 初始化
- `buildEnhancedContext(baseContext, taskDescription, keywords)` - 构建增强上下文
- `buildRuleContext(language, taskType)` - 构建规则上下文
- `getRecommendedAgent(keywords)` - 获取推荐代理
- `listAgents()` - 列出所有代理

### ECCAgentAdapter

将 ECC Agent 适配为 MRX 的执行角色。

**主要方法**：
- `selectAgent(keywords)` - 选择合适的 Agent
- `getCurrentAgent()` - 获取当前选择的 Agent
- `buildAgentContext(agent)` - 构建 Agent 执行上下文
- `generateSystemPrompt(agent)` - 生成完整的 System Prompt
- `getDiagnosticCommands(agent)` - 获取诊断命令
- `getReviewPriorities(agent)` - 获取审查优先级
- `listAgents()` - 列出所有代理

### ECCVerifier

基于 ECC 规则的验证器。

**主要方法**：
- `verify(content, language, taskType)` - 验证内容
- `getInfo()` - 获取验证器信息

## 目录结构

```
openclaw-mrx/
├── core/
│   ├── ecc/                      # ECC 集成核心层
│   │   ├── rule-loader.ts        # 规则加载器
│   │   ├── context-enricher.ts   # 上下文增强器
│   │   ├── ecc-context-builder.ts # 上下文构建器
│   │   ├── agent-adapter.ts      # Agent 适配器
│   │   ├── ecc-verifier.ts       # ECC 验证器
│   │   └── index.ts              # 导出文件
│   ├── memory/
│   ├── planner/
│   ├── validator/
│   ├── reflector/
│   └── ...
├── ecc-assets/                   # ECC 核心资产
│   ├── rules/                    # 规则库
│   │   ├── common/
│   │   ├── typescript/
│   │   ├── python/
│   │   └── ...
│   └── agents/                   # 代理定义
│       ├── typescript-reviewer.md
│       ├── python-reviewer.md
│       └── ...
└── ...
```

## 使用场景

### 场景 1：TypeScript 代码审查

```typescript
const keywords = ["typescript", "review", "security"];
const agent = adapter.selectAgent(keywords);
const context = builder.buildEnhancedContext(baseContext, task, keywords);

// MRX 现在拥有：
// 1. typescript-reviewer Agent 的完整指导
// 2. TypeScript 相关的所有 ECC 规则
// 3. 安全审查的检查清单
// 4. 诊断命令和审查优先级
```

### 场景 2：Python 项目安全审计

```typescript
const keywords = ["python", "security", "audit"];
const rules = loader.getRulesByLanguage("python");
const agent = adapter.selectAgent(keywords);

// MRX 现在能够：
// 1. 使用 python-reviewer Agent 的身份
// 2. 应用 Python 特定的安全规则
// 3. 执行 Python 安全检查命令
// 4. 按优先级进行审查
```

### 场景 3：性能优化

```typescript
const keywords = ["performance", "optimize"];
const rules = loader.getRulesByKeywords(keywords);

// MRX 现在能够：
// 1. 识别性能瓶颈
// 2. 应用 ECC 性能优化规则
// 3. 提供优化建议
```

## 最佳实践

### 1. 初始化

始终在使用前初始化加载器：

```typescript
const builder = new ECCContextBuilder();
await builder.initialize();
```

### 2. 关键词提取

从任务描述中提取关键词以获得最佳匹配：

```typescript
const keywords = extractKeywords(taskDescription);
// 例如：["typescript", "security", "review"]
```

### 3. 上下文注入

在 LLM 提示中注入增强的上下文：

```typescript
const enhancedContext = await builder.buildEnhancedContext(...);
const systemPrompt = `${basePrompt}\n\n${enhancedContext.text}`;
```

### 4. Agent 选择

根据任务类型选择合适的 Agent：

```typescript
const agent = adapter.selectAgent(keywords);
if (agent) {
  const systemPrompt = adapter.generateSystemPrompt(agent);
}
```

## 性能考虑

- **初始化**：首次加载规则和代理需要 1-2 秒
- **检索**：按关键词检索规则通常 < 100ms
- **上下文构建**：构建增强上下文通常 < 500ms
- **缓存**：考虑缓存已加载的规则以提高性能

## 扩展

### 添加新的 ECC 规则

1. 在 `ecc-assets/rules/<language>/` 中创建新的 `.md` 文件
2. 规则加载器会自动发现和加载它

### 添加新的 ECC Agent

1. 在 `ecc-assets/agents/` 中创建新的 `.md` 文件
2. 遵循现有 Agent 的格式（YAML 前置元数据 + Markdown 内容）
3. Agent 适配器会自动发现和加载它

### 自定义验证器

继承 `ECCVerifier` 并实现自定义检查逻辑：

```typescript
class CustomVerifier extends ECCVerifier {
  private checkCustomRule(content: string): boolean {
    // 自定义检查逻辑
  }
}
```

## 故障排查

### 问题：规则未加载

**解决方案**：
1. 检查 `ecc-assets/rules/` 目录是否存在
2. 确保调用了 `initialize()`
3. 查看控制台日志中的加载信息

### 问题：Agent 未匹配

**解决方案**：
1. 检查关键词是否与 Agent ID 匹配
2. 尝试使用更具体的关键词
3. 使用 `listAgents()` 查看可用的 Agent

### 问题：验证结果不准确

**解决方案**：
1. 检查规则的优先级设置
2. 验证内容是否正确传递
3. 查看验证器的日志输出

## 许可证

MIT License

## 相关资源

- [MRX 原始仓库](https://github.com/zhbcher/openclaw-mrx)
- [ECC 原始仓库](https://github.com/affaan-m/ECC)
- [ECC 规则文档](./ecc-assets/rules/README.md)
