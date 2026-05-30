/**
 * API Auth Middleware — API Key / JWT 认证
 * 
 * 高危操作（rollback/pause/delete）需要额外确认。
 */

import type { IncomingMessage } from "http";

export type AuthRole = "read" | "write" | "admin";

export interface AuthContext {
  authenticated: boolean;
  role: AuthRole;
  apiKey?: string;
}

const VALID_API_KEYS = new Set(
  (process.env.MRX_API_KEYS || "mrx-dev-key")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean)
);

const ADMIN_API_KEYS = new Set(
  (process.env.MRX_ADMIN_KEYS || process.env.MRX_API_KEYS || "mrx-dev-key")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean)
);

/** 从请求中提取认证信息 */
export function authenticate(req: IncomingMessage): AuthContext {
  const authHeader = req.headers["authorization"];
  
  if (!authHeader) {
    return { authenticated: false, role: "read" };
  }

  // Bearer token
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (ADMIN_API_KEYS.has(token)) {
      return { authenticated: true, role: "admin", apiKey: token };
    }
    if (VALID_API_KEYS.has(token)) {
      return { authenticated: true, role: "write", apiKey: token };
    }
  }

  return { authenticated: false, role: "read" };
}

/** 需要 admin 权限的操作 */
const ADMIN_ACTIONS = [
  "rollback",
  "delete",
];

/** 需要 write 权限的操作 */
const WRITE_ACTIONS = [
  "pause",
  "resume",
  "create",
  "update",
];

/** 检查是否有权限执行操作 */
export function authorize(ctx: AuthContext, action: string): { allowed: boolean; reason?: string } {
  if (ADMIN_ACTIONS.some(a => action.includes(a))) {
    if (ctx.role !== "admin") {
      return { allowed: false, reason: `操作 "${action}" 需要 admin 权限` };
    }
  }

  if (WRITE_ACTIONS.some(a => action.includes(a))) {
    if (ctx.role === "read") {
      return { allowed: false, reason: `操作 "${action}" 需要 write 权限` };
    }
  }

  return { allowed: true };
}

/** 速率限制（简单内存版） */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number = 100, windowMs: number = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}
