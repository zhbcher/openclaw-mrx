/**
 * Event Bus — 系统事件发布/订阅
 * 
 * Phase 3 启用。所有模块通过 Event Bus 通信，
 * 实现完全可观测的系统。
 * 
 * 事件类型：24 种（定义在 types.ts）
 * 存储格式：JSONL（追加写，高效）
 */

import * as fs from "fs";
import * as path from "path";
import type { MRXEvent, EventKind, LoopPhase } from "../types.js";

type EventHandler = (event: MRXEvent) => void;

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private eventsDir: string;
  private missionId: string;
  private eventsLog: MRXEvent[] = [];

  constructor(storageRoot: string, missionId: string) {
    this.missionId = missionId;
    this.eventsDir = path.join(storageRoot, "events", missionId);
  }

  /**
   * 发布事件
   */
  emit(
    kind: EventKind,
    data?: Record<string, unknown>,
    iteration?: number,
    taskId?: string,
    phase?: LoopPhase
  ): MRXEvent {
    const event: MRXEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind,
      mission_id: this.missionId,
      timestamp: new Date().toISOString(),
      iteration,
      task_id: taskId,
      phase,
      data,
    };

    // 通知处理器
    const handlers = this.handlers.get(kind) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`EventBus handler error for ${kind}:`, err);
      }
    }

    // 通配符处理器
    const allHandlers = this.handlers.get("*") || [];
    for (const handler of allHandlers) {
      try {
        handler(event);
      } catch {
        // 静默吞掉
      }
    }

    // 追加到内存日志
    this.eventsLog.push(event);

    return event;
  }

  /**
   * 订阅事件
   */
  on(kind: EventKind | "*", handler: EventHandler): void {
    const existing = this.handlers.get(kind) || [];
    existing.push(handler);
    this.handlers.set(kind, existing);
  }

  /**
   * 持久化事件到磁盘（JSONL 格式）
   */
  flush(): void {
    if (this.eventsLog.length === 0) return;

    if (!fs.existsSync(this.eventsDir)) {
      fs.mkdirSync(this.eventsDir, { recursive: true });
    }

    const filePath = path.join(this.eventsDir, "events.jsonl");
    const lines = this.eventsLog.map(e => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(filePath, lines, "utf-8");
    this.eventsLog = [];
  }

  /**
   * 获取事件日志（内存中）
   */
  getEvents(): MRXEvent[] {
    return [...this.eventsLog];
  }

  /**
   * 获取事件统计
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const event of this.eventsLog) {
      stats[event.kind] = (stats[event.kind] || 0) + 1;
    }
    return stats;
  }
}
