-- MRX State Graph Schema v1 — ARCHITECTURE FREEZE
-- SQLite WAL mode. All state mutations go through these tables.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- Objectives
-- ============================================================
CREATE TABLE IF NOT EXISTS objectives (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','planning','ready','running','paused','completed','failed','archived')),
  progress    REAL NOT NULL DEFAULT 0.0,
  priority    TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('low','medium','high','critical')),
  tags        TEXT DEFAULT '[]',          -- JSON array
  repo        TEXT DEFAULT '',
  branch      TEXT DEFAULT '',
  working_dir TEXT DEFAULT '',
  constraints TEXT DEFAULT '[]',          -- JSON array
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  completed_at TEXT,
  error       TEXT
);

-- ============================================================
-- Goals
-- ============================================================
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  deliverable TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','ready','running','blocked','completed','failed','skipped')),
  progress    REAL NOT NULL DEFAULT 0.0,
  complexity  TEXT NOT NULL DEFAULT 'medium'
              CHECK (complexity IN ('low','medium','high')),
  depends_on  TEXT DEFAULT '[]',          -- JSON array of goal IDs
  task_ids    TEXT DEFAULT '[]',          -- JSON array of task IDs
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  completed_at TEXT,
  error       TEXT
);

-- ============================================================
-- Tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','ready','running','done','failed','retrying','blocked')),
  depends_on  TEXT DEFAULT '[]',          -- JSON array of task IDs
  children    TEXT DEFAULT '[]',          -- JSON array of task IDs (反向引用)
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  result      TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  completed_at TEXT
);

-- ============================================================
-- Missions (runtime wrapper)
-- ============================================================
CREATE TABLE IF NOT EXISTS missions (
  id              TEXT PRIMARY KEY,
  objective_id    TEXT NOT NULL REFERENCES objectives(id),
  status          TEXT NOT NULL DEFAULT 'created'
                  CHECK (status IN ('created','planning','ready','running','paused','completed','failed','archived')),
  current_phase   TEXT DEFAULT 'observe',
  current_iteration INTEGER NOT NULL DEFAULT 0,
  current_task_id TEXT,
  budget_tokens   INTEGER NOT NULL DEFAULT 0,
  budget_duration REAL NOT NULL DEFAULT 0.0,
  budget_cost     REAL NOT NULL DEFAULT 0.0,
  max_tokens      INTEGER NOT NULL DEFAULT 1000000,
  max_duration_h  REAL NOT NULL DEFAULT 12.0,
  max_cost_usd    REAL NOT NULL DEFAULT 50.0,
  max_iterations  INTEGER NOT NULL DEFAULT 50,
  last_checkpoint_id TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);

-- ============================================================
-- Events (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  mission_id  TEXT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  payload     TEXT NOT NULL DEFAULT '{}'  -- JSON
);

-- ============================================================
-- Checkpoints (状态快照)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkpoints (
  id              TEXT PRIMARY KEY,
  mission_id      TEXT NOT NULL,
  iteration       INTEGER NOT NULL,
  phase           TEXT NOT NULL,
  snapshot_data   TEXT NOT NULL,           -- JSON: CheckpointSnapshot
  context_summary TEXT DEFAULT '',
  parent_id       TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_mission ON checkpoints(mission_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_iteration ON checkpoints(mission_id, iteration);

CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);

-- ============================================================
-- Locks (lease-based, not file-based)
-- ============================================================
CREATE TABLE IF NOT EXISTS locks (
  lock_key    TEXT PRIMARY KEY,
  owner_pid   INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);

-- ============================================================
-- Memory entries (minimal — Recall Engine fleshes this out later)
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_entries (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL,
  type        TEXT NOT NULL
              CHECK (type IN ('decision','failure','solution','pattern','knowledge')),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT DEFAULT '[]',
  confidence  REAL NOT NULL DEFAULT 0.5,
  objective_id TEXT,
  goal_id     TEXT,
  task_id     TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  decay_factor REAL NOT NULL DEFAULT 1.0,
  created_at  TEXT NOT NULL,
  last_recalled_at TEXT
);
