/** 静默错误日志 — 替代空 catch 块 */
export function logSilentError(module: string, err: unknown): void {
  console.error(`[${module}] silent error:`, err instanceof Error ? err.message : String(err));
}
