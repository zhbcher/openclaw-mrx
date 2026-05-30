# ADR-001: Hybrid Planner（LLM + 规则双层）

**状态**：已采纳  
**日期**：2026-05-30  
**决策者**：旺财 + 龙虾（外部架构审计）

---

## 背景

MRX 当前 Planner 使用关键词匹配 + 预设模板生成任务 DAG。对于"开发量化交易平台"这类目标，只能生成三步通用任务（理解目标 → 实施变更 → 验证结果），本质上不是真正的规划。

需要选择一种 Planner 策略来替代现有实现。

## 方案对比

### 方案 A：纯规则引擎

```
关键词 → 模板匹配 → DAG
```

**优点**：快、稳定、可预测、零成本  
**缺点**：无法处理未知目标，词典维护成本随领域线性增长

### 方案 B：纯 LLM

```
Objective → LLM → DAG
```

**优点**：泛化能力强，能处理任意目标  
**缺点**：结果不稳定（同一目标两次拆解不同），成本高，容易漂移

### 方案 C：Hybrid（采纳）

```
Objective → LLM（Goal 分解）→ 规则（校验 + 展开）→ DAG
```

**优点**：LLM 负责创造力那一下（Objective → Goal[]），规则负责确定性部分（循环检测、去重、Epic→Task 展开）  
**缺点**：架构复杂度略高，需要维护 Goal Validator 规则集

## 决策

采用 **Hybrid Planner**。理由：

1. OpenHands、Devin、Claude Code 最终都收敛到此架构
2. LLM 只需做"宏观拆解"（3-7 个 Goal），不需要理解具体的代码实现过程
3. Goal Validator 作为安全网，拦截 LLM 的幻觉输出（循环依赖、语义重复、引用不存在的依赖）
4. 规则引擎展开 Epic→Task 是确定性操作，不应委托给 LLM

## 影响

- Planner 模块拆分为 GoalGenerator（LLM）+ GoalValidator（规则）+ HierarchicalPlanner（门面）
- Planner Output 必须符合 `design/contracts/planner-output.schema.json` 定义的 JSON Schema
- 未来切换 LLM 模型只需改 GoalGenerator 的 prompt，不影响下游模块
