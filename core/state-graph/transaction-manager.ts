/**
 * Transaction Manager + Lease Lock
 * 
 * 替代 state.lock 文件锁：
 *   - 基于 SQLite 的 lease lock（TTL 自动过期）
 *   - 进程异常退出 → 锁自动过期，不留死锁
 */

import { getDatabase } from "./database.js";

export class TransactionManager {
  private db = getDatabase();

  /** Run fn inside a transaction */
  transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  /** Run async fn inside a transaction (immediate mode for writes) */
  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.db.prepare("BEGIN IMMEDIATE").run();
    try {
      const result = await fn();
      this.db.prepare("COMMIT").run();
      return result;
    } catch (e) {
      this.db.prepare("ROLLBACK").run();
      throw e;
    }
  }
}

export class LeaseLock {
  private db = getDatabase();
  private pid: number;

  constructor() {
    this.pid = process.pid;
  }

  /**
   * Try to acquire a lease lock.
   * If lock exists but expired, steal it.
   * Returns true if acquired, false if held by another live process.
   */
  acquire(lockKey: string, ttlMs: number = 30000): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    // Check existing lock
    const existing = this.db.prepare("SELECT * FROM locks WHERE lock_key = ?").get(lockKey) as any;
    
    if (existing) {
      // Lock exists — check if expired
      if (new Date(existing.expires_at) < now) {
        // Stale lock — steal it
        this.db.prepare(`UPDATE locks SET owner_pid=?, acquired_at=?, expires_at=?, heartbeat_at=? WHERE lock_key=?`)
          .run(this.pid, now.toISOString(), expiresAt.toISOString(), now.toISOString(), lockKey);
        return true;
      }
      // Lock is still valid, held by another process
      return false;
    }

    // No lock exists — create one
    try {
      this.db.prepare(`INSERT INTO locks (lock_key, owner_pid, acquired_at, expires_at, heartbeat_at) VALUES (?,?,?,?,?)`)
        .run(lockKey, this.pid, now.toISOString(), expiresAt.toISOString(), now.toISOString());
      return true;
    } catch {
      return false; // Race condition — another process got it first
    }
  }

  /**
   * Release the lock
   */
  release(lockKey: string): void {
    this.db.prepare("DELETE FROM locks WHERE lock_key = ? AND owner_pid = ?").run(lockKey, this.pid);
  }

  /**
   * Extend the lease (heartbeat for long-running operations)
   */
  heartbeat(lockKey: string, ttlMs: number = 30000): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    
    const result = this.db.prepare(
      "UPDATE locks SET expires_at = ?, heartbeat_at = ? WHERE lock_key = ? AND owner_pid = ?"
    ).run(expiresAt.toISOString(), now.toISOString(), lockKey, this.pid);
    
    return result.changes > 0;
  }

  isLocked(lockKey: string): boolean {
    const row = this.db.prepare("SELECT * FROM locks WHERE lock_key = ? AND expires_at > ?")
      .get(lockKey, new Date().toISOString()) as any;
    return !!row;
  }

  /** Clean all locks held by current process (called on shutdown) */
  releaseAll(): void {
    this.db.prepare("DELETE FROM locks WHERE owner_pid = ?").run(this.pid);
  }
}
