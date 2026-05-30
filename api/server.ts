/**
 * MRX Runtime API Server — 基于 Node.js 内置 http 模块
 * 
 * 无外部依赖（不引入 Express/Koa），保持最小化。
 * 实现 OpenAPI Contract 定义的全部端点。
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface Route {
  method: HttpMethod;
  path: RegExp;            // 匹配路径（支持路径参数）
  handler: (req: http.IncomingMessage, params: Record<string, string>, body: any) => Promise<RouteResponse>;
  authRequired?: boolean;
}

export interface RouteResponse {
  status: number;
  body: any;
  headers?: Record<string, string>;
}

export class ApiServer {
  private routes: Route[] = [];
  private server: http.Server | null = null;
  private apiKey: string | null = null;

  constructor(options?: { apiKey?: string }) {
    this.apiKey = options?.apiKey || null;
  }

  /** 注册路由 */
  addRoute(route: Route): this {
    this.routes.push(route);
    return this;
  }

  /** 批量注册 */
  addRoutes(routes: Route[]): this {
    this.routes.push(...routes);
    return this;
  }

  /** 启动服务 */
  start(port: number = 3620): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, () => {
        console.log(`\n  🚀 MRX Runtime API: http://localhost:${port}/api/v1`);
        console.log(`  📋 ${this.routes.length} 个端点已注册`);
        resolve();
      });
    });
  }

  /** 停止 */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost`);
    const method = req.method as HttpMethod;

    // 解析 body
    let body: any = null;
    if (method === "POST" || method === "PATCH") {
      body = await this.parseBody(req);
    }

    // 匹配路由
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = url.pathname.match(route.path);
      if (!match) continue;

      // 认证检查
      if (route.authRequired !== false && this.apiKey) {
        const auth = req.headers["authorization"];
        if (!auth || auth !== `Bearer ${this.apiKey}`) {
          this.sendJson(res, 401, { code: "UNAUTHORIZED", message: "Invalid or missing API key" });
          return;
        }
      }

      try {
        const params = match.groups || {};
        const result = await route.handler(req, params, body);
        this.sendJson(res, result.status, result.body, result.headers);
      } catch (err) {
        this.sendJson(res, 500, {
          code: "INTERNAL_ERROR",
          message: (err as Error).message,
        });
      }
      return;
    }

    // 404
    this.sendJson(res, 404, { code: "NOT_FOUND", message: `No route: ${method} ${url.pathname}` });
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
  }

  private sendJson(res: http.ServerResponse, status: number, body: any, headers?: Record<string, string>): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(json)),
      ...headers,
    });
    res.end(json);
  }
}
