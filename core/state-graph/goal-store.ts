/**
 * Goal Store — CRUD operations for goals table
 */

import { getDatabase } from "./database.js";

export interface GoalRow {
  id: string;
  objective_id: string;
  title: string;
  description: string;
  deliverable: string;
  status: string;
  progress: number;
  complexity: string;
  depends_on: string;   // JSON array
  task_ids: string;     // JSON array
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export class GoalStore {
  private db = getDatabase();

  create(goal: {
    id: string;
    objective_id: string;
    title: string;
    description?: string;
    deliverable?: string;
    complexity?: string;
    depends_on?: string[];
  }): GoalRow {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO goals (id, objective_id, title, description, deliverable, status, complexity, depends_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `);
    stmt.run(
      goal.id, goal.objective_id, goal.title,
      goal.description || "", goal.deliverable || "",
      goal.complexity || "medium",
      JSON.stringify(goal.depends_on || []),
      now, now
    );
    return this.getById(goal.id)!;
  }

  getById(id: string): GoalRow | undefined {
    return this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
  }

  listByObjective(objectiveId: string): GoalRow[] {
    return this.db.prepare("SELECT * FROM goals WHERE objective_id = ? ORDER BY id").all(objectiveId) as GoalRow[];
  }

  updateStatus(id: string, status: string, error?: string): void {
    const now = new Date().toISOString();
    const updates: string[] = ["status = ?", "updated_at = ?"];
    const params: any[] = [status, now];
    
    if (status === "running" && !this.getById(id)?.started_at) {
      updates.push("started_at = ?");
      params.push(now);
    }
    if (status === "completed" || status === "failed") {
      updates.push("completed_at = ?");
      params.push(now);
    }
    if (error !== undefined) { updates.push("error = ?"); params.push(error); }
    
    params.push(id);
    this.db.prepare(`UPDATE goals SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  updateProgress(id: string, progress: number): void {
    this.db.prepare("UPDATE goals SET progress = ?, updated_at = ? WHERE id = ?")
      .run(Math.min(1, Math.max(0, progress)), new Date().toISOString(), id);
  }

  addTaskId(goalId: string, taskId: string): void {
    const goal = this.getById(goalId);
    if (!goal) return;
    const taskIds: string[] = JSON.parse(goal.task_ids);
    if (!taskIds.includes(taskId)) {
      taskIds.push(taskId);
      this.db.prepare("UPDATE goals SET task_ids = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(taskIds), new Date().toISOString(), goalId);
    }
  }

  /** Get goal IDs that this goal depends on */
  getDependencies(goalId: string): string[] {
    const goal = this.getById(goalId);
    return goal ? JSON.parse(goal.depends_on) : [];
  }

  /**
   * Cycle detection: returns true if adding dep creates a cycle
   */
  static wouldCreateCycle(goals: GoalRow[], goalId: string, newDepId: string): boolean {
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const g of goals) {
      adj.set(g.id, JSON.parse(g.depends_on));
    }
    
    // Add the proposed edge
    const current = adj.get(goalId) || [];
    adj.set(goalId, [...current, newDepId]);

    // DFS cycle detection from newDepId → goalId path
    const visited = new Set<string>();
    const recStack = new Set<string>();
    
    function hasCycle(node: string): boolean {
      if (recStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      recStack.add(node);
      for (const dep of (adj.get(node) || [])) {
        if (hasCycle(dep)) return true;
      }
      recStack.delete(node);
      return false;
    }

    return hasCycle(goalId);
  }
}
