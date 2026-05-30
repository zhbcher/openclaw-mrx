# ADR-002: SQLite WAL 替代 state.yaml

**状态**：已采纳  
**日期**：2026-05-30  
**决策者**：旺财 + 龙虾（外部架构审计）

---

## 背景

MRX 当前使用 `fs.writeFileSync` 全量写入 `state.yaml` 作为状态持久化方案。每次状态变更触发一次同步磁盘写操作。100 次循环 = 100 次全量刷盘。锁机制使用进程 PID 文件锁，进程异常退出后锁残留导致死锁。

## 问题

1. **IO 阻塞**：同步写操作在单线程 Node.js 中阻塞事件循环
2. **并发不安全**：文件锁在进程崩溃时永久残留
3. **全量写**：每次写入完整 state.yaml 而非增量
4. **查询能力为零**：yaml 文件不支持条件查询、聚合、分页

## 方案对比

### 方案 A：保持 state.yaml + 异步化

```typescript
fs.promises.writeFile() + 内存缓冲
```

**优点**：改动最小  
**缺点**：仍然全量写，查询能力依然为零，锁问题依然存在

### 方案 B：SQLite WAL（采纳）

```sql
PRAGMA journal_mode=WAL;
```
```
Objectives | Goals | Tasks | Missions | Events | Locks | Memory
```

**优点**：
- WAL 模式：读不阻塞写，写不阻塞读
- 增量写入：只写变更的行，不是整个状态树
- SQL 查询：支持条件过滤、聚合统计、分页
- Lease Lock：基于 TTL 的租约锁，进程崩溃自动过期
- 单文件部署：零外部依赖（better-sqlite3 原生模块）

**缺点**：
- 引入 better-sqlite3 原生模块依赖（arm64 需编译）
- 不再能直接 `cat state.yaml` 查看状态（需 CLI 命令）

### 方案 C：外部数据库（PostgreSQL/MySQL）

**优点**：成熟的运维生态  
**缺点**：与 OpenClaw 本地优先哲学冲突，引入外部依赖

## 决策

采用 **SQLite WAL** 作为唯一状态源。YAML 仅限 checkpoint 快照导出用途。

## 影响

- `state-manager.ts` 重构为 State Graph 门面，底层委托 SQLite stores
- `state.lock` 文件锁 → SQLite-based Lease Lock（TTL 30s，支持心跳续约）
- `state.yaml` 不再作为运行时存储，仅通过 `snapshot-exporter.ts` 按需导出
- Schema 定义在 `core/state-graph/schema.sql`，由 `database.ts` 的 `migrate()` 自动执行
