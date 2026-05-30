# 失败记录

> Mission: qmd_test_mission | 2 条 | 自动编译

## SQLite WAL 文件过大导致磁盘满

- **时间**: 2026-05-30T13:12:03.531Z
- **标签**: sqlite, wal, disk-full
- **可信度**: 95%

生产环境 WAL 文件增长到 2GB。根因：checkpoint 间隔过长。修复：PRAGMA wal_autocheckpoint=1000。

---

## Node.js 事件循环阻塞

- **时间**: 2026-05-30T13:12:03.531Z
- **标签**: node, event-loop, io
- **可信度**: 88%

同步 fs.writeFileSync 阻塞事件循环，导致 API 超时。迁移到异步 IO 后解决。

---
