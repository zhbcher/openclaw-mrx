import { getDatabase } from "./database.js";

/** 清理测试数据，比 rm -f data/mrx.db 更快 */
export function cleanupTestData() {
  const db = getDatabase();
  db.prepare("PRAGMA foreign_keys = OFF").run();
  try {
    for (const table of ["checkpoints", "events", "tasks", "goals", "objectives", "missions", "locks", "memory_entries"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    console.log("  🧹 数据库清理完成");
  } finally {
    db.prepare("PRAGMA foreign_keys = ON").run();
  }
}
