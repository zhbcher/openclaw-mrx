/**
 * Mission Registry — SQLite-based mission lifecycle management
 *
 * Phase 4a: 替代纯文件系统方案，支持：
 *   - 多 Mission 并行注册与查询
 *   - 状态追踪
 *   - 优先级排序
 *   - 并发锁（真正启用 Phase 1 预留的锁机制）
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import type { MissionStatus } from "../types.js";

export interface MissionRecord {
  id: string;
  name: string;
  config_path: string;
  state_path: string;
  status: MissionStatus;
  priority: number;
  current_iteration: number;
  dag_progress_done: number;
  dag_progress_total: number;
  last_checkpoint_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface MissionFilter {
  status?: MissionStatus | MissionStatus[];
  priority_min?: number;
  search?: string;
}

export class MissionRegistry {
  private db: Database.Database;
  private dbPath: string;

  constructor(storageRoot: string) {
    this.dbPath = path.join(storageRoot, "registry.db");
    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_path TEXT NOT NULL,
        state_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        priority INTEGER DEFAULT 5,
        current_iteration INTEGER DEFAULT 0,
        dag_progress_done INTEGER DEFAULT 0,
        dag_progress_total INTEGER DEFAULT 0,
        last_checkpoint_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
      CREATE INDEX IF NOT EXISTS idx_missions_priority ON missions(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_missions_updated ON missions(updated_at DESC);
    `);
  }

  // ============================================================
  // CRUD
  // ============================================================

  register(mission: Omit<MissionRecord, "created_at" | "updated_at">): MissionRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO missions (
        id, name, config_path, state_path, status, priority,
        current_iteration, dag_progress_done, dag_progress_total,
        last_checkpoint_id, last_error, created_at, updated_at
      ) VALUES (
        @id, @name, @config_path, @state_path, @status, @priority,
        @current_iteration, @dag_progress_done, @dag_progress_total,
        @last_checkpoint_id, @last_error, @created_at, @updated_at
      )
    `);

    const record = { ...mission, created_at: now, updated_at: now };
    stmt.run(record);
    return record as MissionRecord;
  }

  get(id: string): MissionRecord | null {
    const row = this.db.prepare("SELECT * FROM missions WHERE id = ?").get(id);
    return row ? (row as MissionRecord) : null;
  }

  list(filter?: MissionFilter): MissionRecord[] {
    let query = "SELECT * FROM missions WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      query += ` AND status IN (${statuses.map(() => "?").join(",")})`;
      params.push(...statuses);
    }
    if (filter?.priority_min !== undefined) {
      query += " AND priority >= ?";
      params.push(filter.priority_min);
    }
    if (filter?.search) {
      query += " AND (name LIKE ? OR id LIKE ?)";
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    query += " ORDER BY priority DESC, created_at ASC";
    return this.db.prepare(query).all(...params) as MissionRecord[];
  }

  updateStatus(id: string, status: MissionStatus): void {
    const now = new Date().toISOString();
    const updates: Record<string, string> = { status, updated_at: now };
    if (status === "running" && !this.get(id)?.started_at) {
      updates.started_at = now;
    }
    if (status === "completed" || status === "archived") {
      updates.completed_at = now;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const values = Object.values(updates);
    this.db.prepare(`UPDATE missions SET ${setClauses} WHERE id = ?`).run(...values, id);
  }

  updateProgress(
    id: string,
    iteration: number,
    dagDone: number,
    dagTotal: number,
    checkpointId?: string,
    error?: string
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE missions SET
        current_iteration = ?,
        dag_progress_done = ?,
        dag_progress_total = ?,
        last_checkpoint_id = COALESCE(?, last_checkpoint_id),
        last_error = ?,
        updated_at = ?
      WHERE id = ?
    `).run(iteration, dagDone, dagTotal, checkpointId || null, error || null, now, id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM missions WHERE id = ?").run(id);
  }

  // ============================================================
  // 查询方法
  // ============================================================

  getActive(): MissionRecord[] {
    return this.list({ status: ["ready", "running"] });
  }

  getRunnable(): MissionRecord[] {
    // ready + 未达到迭代上限的 running
    const rows = this.db.prepare(`
      SELECT * FROM missions
      WHERE status IN ('ready', 'running')
      ORDER BY priority DESC, created_at ASC
    `).all() as MissionRecord[];
    return rows;
  }

  getPaused(): MissionRecord[] {
    return this.list({ status: "paused" });
  }

  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    paused: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('ready','running') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused
      FROM missions
    `).get() as Record<string, number>;

    return {
      total: row.total || 0,
      active: row.active || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      paused: row.paused || 0,
    };
  }

  close(): void {
    this.db.close();
  }
}
