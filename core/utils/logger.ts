/**
 * Structured Logger — 统一日志 + Trace ID
 * 
 * 每条日志包含：
 *   - timestamp: ISO 8601 时间戳
 *   - level: debug/info/warn/error
 *   - traceId: 贯穿 Objective→Goal→Task 全链路
 *   - module: 模块名
 *   - message: 日志内容
 *   - data: 可选的附加数据
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  traceId?: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

let globalTraceId: string | undefined;
let globalLogLevel: LogLevel = "info";

/** 设置当前 Trace ID（每个 Mission 启动时调用） */
export function setTraceId(traceId: string): void {
  globalTraceId = traceId;
}

/** 获取当前 Trace ID */
export function getTraceId(): string | undefined {
  return globalTraceId;
}

/** 生成新 Trace ID */
export function newTraceId(prefix: string = "mrx"): string {
  globalTraceId = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return globalTraceId;
}

/** 设置日志级别 */
export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLogLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: globalTraceId,
      module: this.module,
      message,
      data,
    };

    const prefix = `[${entry.timestamp.slice(11, 19)}] [${level.toUpperCase()}] [${this.module}]`;
    const traceStr = entry.traceId ? ` [${entry.traceId.slice(-8)}]` : "";
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";

    switch (level) {
      case "error": console.error(`${prefix}${traceStr} ${message}${dataStr}`); break;
      case "warn":  console.warn(`${prefix}${traceStr} ${message}${dataStr}`); break;
      case "debug": console.debug(`${prefix}${traceStr} ${message}${dataStr}`); break;
      default:      console.log(`${prefix}${traceStr} ${message}${dataStr}`);
    }
  }

  debug(msg: string, data?: Record<string, unknown>) { this.log("debug", msg, data); }
  info(msg: string, data?: Record<string, unknown>) { this.log("info", msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.log("warn", msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.log("error", msg, data); }

  /** 带 traceId 的子 logger */
  child(subModule: string): Logger {
    return new Logger(`${this.module}.${subModule}`);
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}

/** 全局默认 logger */
export const logger = new Logger("mrx");
