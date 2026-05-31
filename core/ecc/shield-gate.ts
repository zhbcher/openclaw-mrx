/**
 * AgentShield Gate — ECC AgentShield 安全门控
 * 
 * 在 MRX VALIDATE 和 JUDGE 阶段插入 AgentShield 安全审计。
 * 使用 ecc-agentshield npm 包（需单独安装）。
 * 
 * 注意：此模块是可选集成，AgentShield 未安装时自动降级。
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Shield 扫描报告
 */
export interface ShieldReport {
  passed: boolean;
  critical: number;
  high: number;
  medium: number;
  low: number;
  violations: ShieldViolation[];
  summary: string;
}

export interface ShieldViolation {
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
  file?: string;
  line?: number;
  message: string;
}

/**
 * AgentShield 门控
 */
export class AgentShieldGate {
  private available = false;

  constructor() {
    this.checkAvailability();
  }

  /**
   * 检查 AgentShield 是否可用
   */
  private checkAvailability(): void {
    try {
      execSync("npx ecc-agentshield --version 2>/dev/null", { 
        stdio: "pipe",
        timeout: 5000,
      });
      this.available = true;
      console.log(`  🛡️  AgentShield 可用`);
    } catch (err) {
      this.available = false;
      console.log(`  🛡️  AgentShield 未安装（可选，不影响 MRX 核心功能）`);
    }
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * 扫描文件或目录
   */
  async scan(target: string | string[]): Promise<ShieldReport> {
    if (!this.available) {
      return {
        passed: true,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        violations: [],
        summary: "AgentShield 未安装，跳过扫描",
      };
    }

    const targets = Array.isArray(target) ? target : [target];
    const violations: ShieldViolation[] = [];

    for (const t of targets) {
      try {
        const result = execSync(
          `npx ecc-agentshield scan "${t}" --format json 2>/dev/null`,
          { stdio: "pipe", timeout: 60000, encoding: "utf-8" }
        );

        const parsed = JSON.parse(result);
        if (parsed.violations) {
          violations.push(...parsed.violations);
        }
      } catch (err: any) {
        // JSON 解析失败或执行超时，记录错误但不中断
        console.warn(`  ⚠️  AgentShield 扫描 ${t} 失败: ${err.message?.slice(0, 100)}`);
      }
    }

    const critical = violations.filter(v => v.severity === "critical").length;
    const high = violations.filter(v => v.severity === "high").length;
    const medium = violations.filter(v => v.severity === "medium").length;
    const low = violations.filter(v => v.severity === "low").length;

    return {
      passed: critical === 0 && high === 0,
      critical,
      high,
      medium,
      low,
      violations,
      summary: critical > 0
        ? `🔴 ${critical} 个严重违规`
        : high > 0
          ? `🟠 ${high} 个高危违规`
          : `🟢 安全扫描通过 (${violations.length} 项发现)`,
    };
  }

  /**
   * 使用内置规则快速检查（不依赖 AgentShield 安装）
   * 基于简单模式匹配做安全扫描
   */
  async quickScan(content: string): Promise<ShieldReport> {
    const violations: ShieldViolation[] = [];

    // 硬编码密钥检测
    const secretPatterns = [
      { pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi, msg: "可能的硬编码凭证" },
      { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, msg: "检测到私钥" },
      { pattern: /ghp_[a-zA-Z0-9]{36}/g, msg: "检测到 GitHub Token" },
      { pattern: /sk-[a-zA-Z0-9]{32,}/g, msg: "检测到 OpenAI API Key" },
    ];

    for (const { pattern, msg } of secretPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        violations.push({
          rule: "secrets-detection",
          severity: "critical",
          message: `${msg} (${matches.length} 处)`,
        });
      }
    }

    // 危险函数检测
    const dangerousPatterns = [
      { pattern: /\beval\s*\(/g, msg: "使用 eval() 存在安全风险" },
      { pattern: /\.innerHTML\s*=/g, msg: "直接设置 innerHTML 可能导致 XSS" },
      { pattern: /exec(?:Sync)?\s*\(/g, msg: "命令注入风险" },
    ];

    for (const { pattern, msg } of dangerousPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        violations.push({
          rule: "dangerous-patterns",
          severity: "high",
          message: `${msg} (${matches.length} 处)`,
        });
      }
    }

    const critical = violations.filter(v => v.severity === "critical").length;
    const high = violations.filter(v => v.severity === "high").length;

    return {
      passed: critical === 0 && high === 0,
      critical,
      high,
      medium: 0,
      low: 0,
      violations,
      summary: critical > 0 
        ? `🔴 ${critical} 个严重安全违规` 
        : high > 0 
          ? `🟠 ${high} 个高危安全违规` 
          : `🟢 快速扫描通过`,
    };
  }
}
