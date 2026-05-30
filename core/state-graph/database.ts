/**
 * State Graph Database — SQLite WAL 连接管理
 * 
 * 单例模式。整个 MRX 进程共享一个数据库连接。
 * WAL 模式提供并发读 + 串行写，不阻塞读操作。
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

let _db: Database.Database | null = null;
let _dbPath: string = "";

export function getDatabase(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolved = dbPath || path.join(process.cwd(), "data", "mrx.db");
  _dbPath = resolved;

  // 确保目录存在
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(resolved);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");

  return _db;
}

export function getDbPath(): string {
  return _dbPath;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * 执行 schema migration
 */
export function migrate(): void {
  const db = getDatabase();
  const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), "schema.sql");
  
  // 尝试多个路径
  const candidates = [
    schemaPath,
    path.join(process.cwd(), "core", "state-graph", "schema.sql"),
    path.join(process.cwd(), "dist", "core", "state-graph", "schema.sql"),
  ];

  let sql: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      sql = fs.readFileSync(p, "utf-8");
      break;
    }
  }

  if (sql) {
    db.exec(sql);
    console.log("  📦 State Graph: 数据库已初始化 (WAL mode)");
  } else {
    // 回退到嵌入式 migration
    db.exec(EMBEDDED_SCHEMA);
    console.log("  📦 State Graph: 数据库已初始化 (embedded schema)");
  }
}

const EMBEDDED_SCHEMA = `
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created', progress REAL NOT NULL DEFAULT 0.0,
  priority TEXT NOT NULL DEFAULT 'medium', tags TEXT DEFAULT '[]',
  repo TEXT DEFAULT '', branch TEXT DEFAULT '', working_dir TEXT DEFAULT '',
  constraints TEXT DEFAULT '[]', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, completed_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, objective_id TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT DEFAULT '', deliverable TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', progress REAL NOT NULL DEFAULT 0.0,
  complexity TEXT NOT NULL DEFAULT 'medium', depends_on TEXT DEFAULT '[]',
  task_ids TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  started_at TEXT, completed_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', depends_on TEXT DEFAULT '[]',
  children TEXT DEFAULT '[]', retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3, result TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, objective_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created',
  current_phase TEXT DEFAULT 'observe', current_iteration INTEGER NOT NULL DEFAULT 0,
  current_task_id TEXT, budget_tokens INTEGER NOT NULL DEFAULT 0,
  budget_duration REAL NOT NULL DEFAULT 0.0, budget_cost REAL NOT NULL DEFAULT 0.0,
  max_tokens INTEGER NOT NULL DEFAULT 1000000, max_duration_h REAL NOT NULL DEFAULT 12.0,
  max_cost_usd REAL NOT NULL DEFAULT 50.0, max_iterations INTEGER NOT NULL DEFAULT 50,
  last_checkpoint_id TEXT, last_error TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, mission_id TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
  iteration INTEGER NOT NULL, phase TEXT NOT NULL,
  snapshot_data TEXT NOT NULL, context_summary TEXT DEFAULT '',
  parent_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locks (
  lock_key TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, type TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5, objective_id TEXT, goal_id TEXT, task_id TEXT,
  access_count INTEGER NOT NULL DEFAULT 0, decay_factor REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL, last_recalled_at TEXT
);
`;
