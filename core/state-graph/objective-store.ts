/**
 * Objective Store — CRUD operations for objectives table
 */

import { getDatabase } from "./database.js";

export interface ObjectiveRow {
  id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  priority: string;
  tags: string;
  repo: string;
  branch: string;
  working_dir: string;
  constraints: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error: string | null;
}

export class ObjectiveStore {
  private db = getDatabase();

  create(obj: {
    id: string;
    title: string;
    description?: string;
    priority?: string;
    tags?: string[];
    repo?: string;
    branch?: string;
    working_dir?: string;
    constraints?: string[];
  }): ObjectiveRow {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO objectives (id, title, description, status, priority, tags, repo, branch, working_dir, constraints, created_at, updated_at)
      VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      obj.id, obj.title, obj.description || "",
      obj.priority || "medium", JSON.stringify(obj.tags || []),
      obj.repo || "", obj.branch || "", obj.working_dir || "",
      JSON.stringify(obj.constraints || []), now, now
    );
    return this.getById(obj.id)!;
  }

  getById(id: string): ObjectiveRow | undefined {
    return this.db.prepare("SELECT * FROM objectives WHERE id = ?").get(id) as ObjectiveRow | undefined;
  }

  updateStatus(id: string, status: string, error?: string): void {
    const now = new Date().toISOString();
    const updates: string[] = ["status = ?", "updated_at = ?"];
    const params: any[] = [status, now];
    
    if (error !== undefined) {
      updates.push("error = ?");
      params.push(error);
    }
    if (status === "completed" || status === "failed") {
      updates.push("completed_at = ?");
      params.push(now);
    }
    
    params.push(id);
    this.db.prepare(`UPDATE objectives SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  updateProgress(id: string, progress: number): void {
    this.db.prepare("UPDATE objectives SET progress = ?, updated_at = ? WHERE id = ?")
      .run(Math.min(1, Math.max(0, progress)), new Date().toISOString(), id);
  }

  setGoalIds(id: string, goalIds: string[]): void {
    // Store goal_ids as JSON — we also have goals table FK, this is a convenience cache
    this.db.prepare("UPDATE objectives SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  list(filter?: { status?: string; priority?: string; limit?: number; offset?: number }): ObjectiveRow[] {
    let sql = "SELECT * FROM objectives WHERE 1=1";
    const params: any[] = [];
    
    if (filter?.status) { sql += " AND status = ?"; params.push(filter.status); }
    if (filter?.priority) { sql += " AND priority = ?"; params.push(filter.priority); }
    
    sql += " ORDER BY created_at DESC";
    if (filter?.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
    if (filter?.offset) { sql += " OFFSET ?"; params.push(filter.offset); }
    
    return this.db.prepare(sql).all(...params) as ObjectiveRow[];
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM objectives WHERE id = ?").run(id);
  }
}
