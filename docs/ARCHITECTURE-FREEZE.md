# MRX Architecture Freeze — v1

**Frozen on: 2026-05-30**

## 什么是 Architecture Freeze？

在开始写 MRX 2.0 代码之前，先冻结以下四份契约文件。冻结意味着：

- ✅ 允许：新增字段（向后兼容）
- ✅ 允许：新增事件类型
- ❌ 禁止：删除/重命名字段或事件
- ❌ 禁止：修改字段类型或事件 payload 结构
- ⚠️ 破坏性变更：需走 v2 schema + migration + 版本号升级

## 冻结清单

| # | 文件 | 大小 | 内容 |
|:---|:---|:---|:---|
| 1 | `state-schema/mrx-state-v1.ts` | ~10KB | Objective/Goal/Task/Action/Checkpoint/Memory/Mission 完整类型定义 |
| 2 | `events/domain-events.ts` | ~14KB | 47 个核心领域事件（Objective 10 + Goal 8 + Task 7 + Mission 9 + Checkpoint 2 + Recovery 3 + Memory 3 + Budget/Risk 5） |
| 3 | `contracts/planner-output.schema.json` | ~5KB | LLM Planner 输出 JSON Schema（Goal 拆解合同） |
| 4 | `contracts/openapi.yaml` | ~19KB | Runtime REST API（7 个资源组，26 个端点） |

## 为什么先冻结再写代码？

```
路线图（做什么）
    ↓
架构冻结（每个模块的边界长什么样）  ← 你现在在这里
    ↓
Walking Skeleton（最小垂直接通）
    ↓
P0 模块开发
    ↓
P1/P2 模块开发
```

不冻结就写代码 → 每个模块对同一概念的定义不同 → 后期集成时连锁重构。

## Walking Skeleton 目标

架构冻结完成后，下一步实现最小垂直接通：

```
用户输入 "开发股票系统"
    ↓
Objective Engine（创建 Objective）
    ↓
Hybrid Planner（LLM 拆 Goal）
    ↓
State Graph（SQLite 持久化）
    ↓
输出 Objective + Goals 树
```

不包含：Memory Recall / QMD / Checkpoint / Recovery / Verifier。
这些模块在 Skeleton 跑通后作为外挂接入。

## 相关文档

- `design/mission-runtime-proposal.md` — 旺财 v2 架构设计提案
- `design/mrx-2.0-optimized-roadmap.md` — 13 Phase 重构路线图（文件级 WBS）
