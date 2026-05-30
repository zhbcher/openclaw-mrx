# ADR-004: State Graph 提前到 P0（基础设施优先）

**状态**：已采纳  
**日期**：2026-05-30  
**决策者**：旺财 + 龙虾（外部架构审计）

---

## 背景

原始路线图中 State Graph 排在 P1（第 9 位），在 Objective Engine、Goal Engine、Planner、Memory Recall、QMD Adapter 之后。这意味着前 5 个模块都临时使用 `state.yaml`，后面再迁移到 SQLite。

## 问题

Memory Recall 需要读任务状态、Goal 状态、历史状态。Checkpoint 需要状态快照。Recovery 需要状态回滚。这些本质都依赖统一状态模型。

先做功能模块再补状态底座 → 必重构。

## 决策

将 State Graph 从 P1 第 9 位提前到 P0 第 5 位（API Spec 之后、Memory Recall 之前）。

调整后 P0 顺序：
```
Objective → Goal → Planner → API Spec → State Graph → Memory Recall → QMD Lite
```

**理由**：
1. State Graph 是基础设施层，不是业务功能
2. Memory Recall、Checkpoint、Recovery 都依赖统一状态模型
3. 技术债先欠着再还的模式在此场景下成本极高（5 个模块全部需要重写存储层）

## 影响

- P1 Checkpoint Rollback 可以直接基于 SQLite 做状态快照（而非 yaml 文件拷贝）
- P1 Recovery V2 的 rollback 路径可以直接操作 SQLite 恢复状态
- 后续所有模块的存储层统一走 `core/state-graph/*-store.ts`
