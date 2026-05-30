# 决策记录

> Mission: qmd_test_mission | 1 条 | 自动编译

## 选择 SQLite 作为本地数据库

- **时间**: 2026-05-30T13:12:03.530Z
- **标签**: sqlite, database, architecture
- **可信度**: 90%

评估了 SQLite vs LevelDB。SQLite 在查询能力、工具生态上明显优于 LevelDB。WAL 模式解决了并发读写问题。

---
