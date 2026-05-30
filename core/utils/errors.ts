/**
 * 结构化错误处理系统
 * 
 * 替代裸 Error + 字符串匹配的脆弱模式。
 * Recovery Engine 可以直接读取 error.code 做精确决策。
 */

export enum ErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  PLANNING_ERROR = "PLANNING_ERROR",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  BUDGET_EXCEEDED = "BUDGET_EXCEEDED",
  RECOVERY_FAILED = "RECOVERY_FAILED",
  STATE_TRANSITION_ERROR = "STATE_TRANSITION_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class MRXError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: any,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "MRXError";
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

/** 静默错误日志 */
export function logSilentError(module: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any).code || "UNKNOWN";
  console.error(`[${module}] [${code}] silent error: ${message}`);
}

/**
 * 统一错误处理包装器 — try/catch + fallback
 */
export async function withErrorHandling<T>(
  module: string,
  fn: () => Promise<T>,
  fallback?: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logSilentError(module, err);
    if (fallback !== undefined) return fallback;
    throw err;
  }
}
