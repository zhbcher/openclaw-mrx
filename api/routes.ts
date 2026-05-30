/**
 * API Routes — 注册全部端点
 * 
 * 按照 openapi.yaml 定义的 7 个资源组 + 26 个端点
 */

import { ApiServer, type Route } from "../api/server.js";
import { ObjectiveEngine } from "../core/objective/objective-engine.js";
import { ObjectiveStore } from "../core/state-graph/objective-store.js";
import { GoalStore } from "../core/state-graph/goal-store.js";
import { GoalEngine } from "../core/goal/goal-engine.js";
import { CheckpointManagerV2 } from "../core/checkpoint/checkpoint-v2.js";
import { MetricsEngine } from "../core/metrics/metrics-engine.js";
import { getDatabase, migrate } from "../core/state-graph/database.js";

export function registerAllRoutes(server: ApiServer): void {
  const objectiveEngine = new ObjectiveEngine();
  const objectiveStore = new ObjectiveStore();
  const goalStore = new GoalStore();
  const goalEngine = new GoalEngine();
  const checkpointMgr = new CheckpointManagerV2();
  const metricsEngine = new MetricsEngine();

  const routes: Route[] = [
    // ============================================================
    // Objectives
    // ============================================================
    {
      method: "POST",
      path: /^\/api\/v1\/objectives$/,
      handler: async (_req, _params, body) => {
        if (!body?.title) {
          return { status: 400, body: { code: "VALIDATION_ERROR", message: "title is required" } };
        }
        const obj = objectiveEngine.create({
          title: body.title,
          description: body.description,
          priority: body.priority,
          tags: body.tags,
          workingDir: body.context?.working_dir,
        });
        return { status: 201, body: obj };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/objectives$/,
      handler: async (_req, params) => {
        const { status, priority, limit, offset } = params;
        const objectives = objectiveStore.list({
          status, priority,
          limit: limit ? parseInt(limit) : 20,
          offset: offset ? parseInt(offset) : 0,
        });
        return {
          status: 200,
          body: objectives.map(o => ({
            id: o.id, title: o.title, status: o.status,
            progress: o.progress, priority: o.priority,
            created_at: o.created_at,
          })),
        };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/objectives\/(?<objective_id>[^/]+)$/,
      handler: async (_req, params) => {
        const obj = objectiveEngine.getFull(params.objective_id);
        if (!obj) return { status: 404, body: { code: "NOT_FOUND", message: "Objective not found" } };
        return { status: 200, body: obj };
      },
    },
    {
      method: "DELETE",
      path: /^\/api\/v1\/objectives\/(?<objective_id>[^/]+)$/,
      handler: async (_req, params) => {
        try {
          // 先删子记录（goals 有 CASCADE, 手工保证 missions）
          const db = getDatabase();
          db.prepare("DELETE FROM missions WHERE objective_id = ?").run(params.objective_id);
          db.prepare("DELETE FROM goals WHERE objective_id = ?").run(params.objective_id);
          objectiveStore.delete(params.objective_id);
          return { status: 200, body: { success: true } };
        } catch (err) {
          return { status: 500, body: { code: "INTERNAL_ERROR", message: (err as Error).message } };
        }
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/objectives\/(?<objective_id>[^/]+)\/progress$/,
      handler: async (_req, params) => {
        const obj = objectiveEngine.getFull(params.objective_id);
        if (!obj) return { status: 404, body: { code: "NOT_FOUND" } };
        const goals = obj.goals.map(g => ({
          goal_id: g.id, goal_title: g.title, status: g.status,
          progress: g.progress, tasks_done: 0, tasks_total: g.task_ids.length,
          tasks_failed: 0, is_blocked: g.status === "blocked",
        }));
        return {
          status: 200,
          body: {
            objective_id: obj.id,
            objective_title: obj.title,
            overall: obj.progress,
            goals,
          },
        };
      },
    },

    // ============================================================
    // Goals
    // ============================================================
    {
      method: "POST",
      path: /^\/api\/v1\/objectives\/(?<objective_id>[^/]+)\/goals$/,
      handler: async (_req, params, body) => {
        if (!body?.title || !body?.deliverable) {
          return { status: 400, body: { code: "VALIDATION_ERROR", message: "title and deliverable required" } };
        }
        const goal = goalStore.create({
          id: `goal_${Date.now()}`,
          objective_id: params.objective_id,
          title: body.title,
          description: body.description,
          deliverable: body.deliverable,
          complexity: body.estimated_complexity,
          depends_on: body.depends_on,
        });
        return { status: 201, body: goal };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/objectives\/(?<objective_id>[^/]+)\/goals$/,
      handler: async (_req, params) => {
        const goals = goalStore.listByObjective(params.objective_id);
        return { status: 200, body: goals };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/goals\/(?<goal_id>[^/]+)$/,
      handler: async (_req, params) => {
        const goal = goalStore.getById(params.goal_id);
        if (!goal) return { status: 404, body: { code: "NOT_FOUND" } };
        return { status: 200, body: goal };
      },
    },
    {
      method: "PATCH",
      path: /^\/api\/v1\/goals\/(?<goal_id>[^/]+)$/,
      handler: async (_req, params, body) => {
        if (body?.status) {
          goalStore.updateStatus(params.goal_id, body.status, body.error);
        }
        const goal = goalStore.getById(params.goal_id);
        return { status: 200, body: goal };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/goals\/(?<goal_id>[^/]+)\/progress$/,
      handler: async (_req, params) => {
        const goal = goalStore.getById(params.goal_id);
        if (!goal) return { status: 404, body: { code: "NOT_FOUND" } };
        const deps = goalEngine.getDependencyStatus(params.goal_id);
        return {
          status: 200,
          body: {
            goal_id: goal.id, goal_title: goal.title,
            status: goal.status, progress: goal.progress,
            tasks_done: 0, tasks_total: JSON.parse(goal.task_ids).length,
            tasks_failed: 0, is_blocked: !deps.allSatisfied,
          },
        };
      },
    },

    // ============================================================
    // Missions
    // ============================================================
    {
      method: "POST",
      path: /^\/api\/v1\/missions$/,
      handler: async (_req, _params, body) => {
        if (!body?.objective_id) {
          return { status: 400, body: { code: "VALIDATION_ERROR", message: "objective_id required" } };
        }
        const now = new Date().toISOString();
        const missionId = `mission_${Date.now()}`;
        const db = getDatabase();
        db.prepare(`INSERT INTO missions (id, objective_id, status, created_at, updated_at)
          VALUES (?, ?, 'created', ?, ?)`).run(missionId, body.objective_id, now, now);
        return { status: 201, body: { id: missionId, objective_id: body.objective_id, status: "created" } };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/missions$/,
      handler: async (_req, params) => {
        const db = getDatabase();
        let sql = "SELECT * FROM missions";
        const args: any[] = [];
        if (params.status) { sql += " WHERE status = ?"; args.push(params.status); }
        sql += " ORDER BY created_at DESC LIMIT 50";
        const missions = db.prepare(sql).all(...args);
        return { status: 200, body: missions };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)$/,
      handler: async (_req, params) => {
        const db = getDatabase();
        const mission = db.prepare("SELECT * FROM missions WHERE id = ?").get(params.mission_id);
        if (!mission) return { status: 404, body: { code: "NOT_FOUND" } };
        return { status: 200, body: mission };
      },
    },
    {
      method: "POST",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)\/pause$/,
      handler: async (_req, params) => {
        const db = getDatabase();
        db.prepare("UPDATE missions SET status = 'paused', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), params.mission_id);
        return { status: 200, body: { success: true } };
      },
    },
    {
      method: "POST",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)\/resume$/,
      handler: async (_req, params) => {
        const db = getDatabase();
        db.prepare("UPDATE missions SET status = 'running', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), params.mission_id);
        return { status: 200, body: { success: true } };
      },
    },

    // ============================================================
    // Checkpoints
    // ============================================================
    {
      method: "GET",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)\/checkpoints$/,
      handler: async (_req, params) => {
        const cps = checkpointMgr.listAll(params.mission_id);
        return { status: 200, body: cps.map(cp => ({ id: cp.id, iteration: cp.iteration, phase: cp.phase, created_at: cp.created_at, context_summary: cp.context_summary })) };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)\/checkpoints\/(?<checkpoint_id>[^/]+)$/,
      handler: async (_req, params) => {
        const cp = checkpointMgr.getById(params.checkpoint_id);
        if (!cp) return { status: 404, body: { code: "NOT_FOUND" } };
        return { status: 200, body: cp };
      },
    },
    {
      method: "POST",
      path: /^\/api\/v1\/missions\/(?<mission_id>[^/]+)\/rollback$/,
      handler: async (_req, _params, body) => {
        if (!body?.checkpoint_id) {
          return { status: 400, body: { code: "VALIDATION_ERROR", message: "checkpoint_id required" } };
        }
        const result = await checkpointMgr.rollback(body.checkpoint_id);
        return { status: 200, body: result };
      },
    },

    // ============================================================
    // Reports
    // ============================================================
    {
      method: "GET",
      path: /^\/api\/v1\/reports\/mission\/(?<mission_id>[^/]+)$/,
      handler: async (_req, params) => {
        const report = metricsEngine.getMissionMetrics(params.mission_id);
        if (!report) return { status: 404, body: { code: "NOT_FOUND" } };
        return { status: 200, body: report };
      },
    },
    {
      method: "GET",
      path: /^\/api\/v1\/reports\/global$/,
      handler: async () => {
        const report = metricsEngine.getGlobalMetrics();
        return { status: 200, body: report };
      },
    },
  ];

  server.addRoutes(routes);
}
