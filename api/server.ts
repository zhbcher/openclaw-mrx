#!/usr/bin/env node
/**
 * MRX REST API Server
 *
 * Phase 4a: HTTP API for mission management.
 * Endpoints:
 *   GET    /health                    — health check
 *   GET    /api/missions              — list all missions
 *   GET    /api/missions/:id          — mission detail
 *   POST   /api/missions              — create mission
 *   POST   /api/missions/:id/start    — start mission
 *   POST   /api/missions/:id/pause    — pause mission
 *   POST   /api/missions/:id/resume   — resume mission
 *   GET    /api/missions/:id/events   — SSE event stream
 *   GET    /api/missions/:id/checkpoints — list checkpoints
 *   GET    /api/stats                 — global stats
 */

import * as http from "http";
import * as path from "path";
import * as fs from "fs";

// 延迟导入，避免循环依赖
let scheduler: InstanceType<typeof import("../core/scheduler/mission-scheduler.js").MissionScheduler> | null = null;

const PORT = parseInt(process.env.MRX_API_PORT || "3099", 10);

async function getScheduler() {
  if (!scheduler) {
    const { MissionScheduler } = await import("../core/scheduler/mission-scheduler.js");
    const mrxRoot = path.resolve(import.meta.dirname, "../..");
    const storageRoot = path.resolve(process.env.MRX_STORAGE_ROOT || path.join(mrxRoot, "storage"));
    const missionDir = path.resolve(process.env.MRX_MISSIONS_DIR || path.join(mrxRoot, "missions/active"));
    scheduler = new MissionScheduler({ storageRoot, missionActiveDir: missionDir });
  }
  return scheduler;
}

// ============================================================
// JSON 响应工具
// ============================================================

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data, null, 2));
}

function error(res: http.ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ============================================================
// 路由
// ============================================================

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const method = req.method || "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    const sched = await getScheduler();

    // Health
    if (url.pathname === "/health" && method === "GET") {
      return json(res, { status: "ok", uptime: process.uptime() });
    }

    // Stats
    if (url.pathname === "/api/stats" && method === "GET") {
      return json(res, sched.getStatus());
    }

    // List missions
    if (url.pathname === "/api/missions" && method === "GET") {
      const filter: Record<string, unknown> = {};
      const statusParam = url.searchParams.get("status");
      if (statusParam) filter.status = statusParam;
      const missions = sched.registry.list(filter as any);
      return json(res, missions);
    }

    // Create mission
    if (url.pathname === "/api/missions" && method === "POST") {
      const body = await parseBody(req);
      const { id, name, config_path, priority } = body;

      if (!id || !name || !config_path) {
        return error(res, "Missing required fields: id, name, config_path");
      }

      const statePath = path.join(
        process.env.MRX_MISSIONS_DIR || path.join(path.resolve(import.meta.dirname, "../.."), "missions/active"),
        id as string
      );
      if (!fs.existsSync(statePath)) {
        fs.mkdirSync(statePath, { recursive: true });
      }

      const record = sched.register(
        id as string,
        name as string,
        config_path as string,
        statePath,
        (priority as number) || 5
      );

      return json(res, record, 201);
    }

    // Mission detail
    const missionMatch = url.pathname.match(/^\/api\/missions\/([^/]+)$/);
    if (missionMatch && method === "GET") {
      const mission = sched.registry.get(missionMatch[1]);
      if (!mission) return error(res, "Mission not found", 404);
      return json(res, mission);
    }

    // Start mission
    const startMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/start$/);
    if (startMatch && method === "POST") {
      try {
        await sched.startMission(startMatch[1]);
        return json(res, { status: "started", mission_id: startMatch[1] });
      } catch (err) {
        return error(res, (err as Error).message, 409);
      }
    }

    // Pause mission
    const pauseMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/pause$/);
    if (pauseMatch && method === "POST") {
      await sched.pauseMission(pauseMatch[1]);
      return json(res, { status: "paused", mission_id: pauseMatch[1] });
    }

    // Resume mission
    const resumeMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/resume$/);
    if (resumeMatch && method === "POST") {
      try {
        await sched.resumeMission(resumeMatch[1]);
        return json(res, { status: "resumed", mission_id: resumeMatch[1] });
      } catch (err) {
        return error(res, (err as Error).message, 409);
      }
    }

    // SSE events
    const eventsMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/events$/);
    if (eventsMatch && method === "GET") {
      const missionId = eventsMatch[1];
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // 发送已有事件
      const mrxRoot = path.resolve(import.meta.dirname, "../..");
      const storageRoot = process.env.MRX_STORAGE_ROOT || path.join(mrxRoot, "storage");
      const eventsPath = path.join(storageRoot, "events", missionId, "events.jsonl");
      if (fs.existsSync(eventsPath)) {
        const lines = fs.readFileSync(eventsPath, "utf-8").trim().split("\n").slice(-20);
        for (const line of lines) {
          res.write(`data: ${line}\n\n`);
        }
      }

      // 每 2 秒发送心跳
      const interval = setInterval(() => {
        res.write(`: heartbeat\n\n`);
      }, 2000);

      req.on("close", () => clearInterval(interval));
      return;
    }

    // 404
    error(res, "Not found", 404);
  } catch (err) {
    console.error("API error:", err);
    error(res, "Internal server error", 500);
  }
}

// ============================================================
// 启动
// ============================================================

const server = http.createServer(handleRequest);

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  if (scheduler) await scheduler.shutdownScheduler();
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`\n🚀 MRX API Server listening on http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Missions: http://localhost:${PORT}/api/missions`);
  console.log(`   Stats:   http://localhost:${PORT}/api/stats\n`);
});
