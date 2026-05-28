/**
 * Risk Engine — 四级风险分级
 * 
 * 核心原则：不是所有操作都能让 Agent 自己做决定。
 * 
 * 风险等级：
 *   LOW      → 自动执行（读文件、运行测试、代码搜索）
 *   MEDIUM   → 自动执行 + 记录（修改代码、新建文件、git commit）
 *   HIGH     → 请求用户确认（删除文件、修改依赖、git push）
 *   CRITICAL → 强制阻断（rm -rf、数据库迁移、生产部署、密钥修改）
 */

import type { MissionConfig } from "../types.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskAction = "allow" | "warn" | "require_approval" | "block";

export interface RiskAssessment {
  level: RiskLevel;
  action: RiskAction;
  reason: string;
  blocked: boolean;
}

// ============================================================
// 内置风险规则
// ============================================================

interface RiskRule {
  pattern: RegExp;
  level: RiskLevel;
  action: RiskAction;
  message: string;
}

const BUILTIN_RULES: RiskRule[] = [
  // === CRITICAL ===
  {
    pattern: /rm\s+-rf|rm\s+-r\s+\/|sudo\s+rm/,
    level: "CRITICAL",
    action: "block",
    message: "检测到危险删除操作 (rm -rf)，已阻止",
  },
  {
    pattern: /DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE/,
    level: "CRITICAL",
    action: "block",
    message: "检测到数据库破坏性操作",
  },
  {
    pattern: /DELETE\s+FROM\s+\w+\s*(WHERE\s+1\s*=\s*1|;)\s*$/i,
    level: "CRITICAL",
    action: "block",
    message: "检测到无条件全表删除操作",
  },
  {
    pattern: /ALTER\s+TABLE.*DROP\s+COLUMN/i,
    level: "CRITICAL",
    action: "block",
    message: "检测到删除数据库列操作",
  },
  {
    pattern: />\s*\/dev\/sda|mkfs\.|fdisk|dd\s+if=/,
    level: "CRITICAL",
    action: "block",
    message: "检测到磁盘级危险操作",
  },
  {
    pattern: /chmod\s+777/,
    level: "CRITICAL",
    action: "block",
    message: "检测到 chmod 777 操作，存在安全风险",
  },

  // === HIGH ===
  {
    pattern: /git\s+push\s+.*(main|master|production)/,
    level: "HIGH",
    action: "require_approval",
    message: "检测到向主分支推送，需要人工确认",
  },
  {
    pattern: /npm\s+publish|cargo\s+publish|docker\s+push/,
    level: "HIGH",
    action: "require_approval",
    message: "检测到发布/推送操作，需要人工确认",
  },
  {
    pattern: /git\s+push\s+--force|git\s+push\s+-f/,
    level: "HIGH",
    action: "require_approval",
    message: "检测到强制推送操作，需要人工确认",
  },
  {
    pattern: /npm\s+(uninstall|remove)|pip\s+uninstall|cargo\s+remove/,
    level: "HIGH",
    action: "require_approval",
    message: "检测到依赖删除操作",
  },
  {
    pattern: /kubectl\s+delete|kubectl\s+apply.*production/,
    level: "HIGH",
    action: "require_approval",
    message: "检测到 Kubernetes 生产环境操作",
  },

  // === MEDIUM ===
  {
    pattern: /git\s+commit|git\s+add/,
    level: "MEDIUM",
    action: "warn",
    message: "Git 提交操作",
  },
  {
    pattern: /npm\s+install|yarn\s+add|pip\s+install/,
    level: "MEDIUM",
    action: "warn",
    message: "依赖安装操作",
  },
  {
    pattern: /mv\s+\S+\s+\S+|cp\s+-r/,
    level: "MEDIUM",
    action: "warn",
    message: "文件移动/复制操作",
  },

  // === LOW（默认） ===
];

export class RiskEngine {
  private rules: RiskRule[];

  constructor(config: MissionConfig) {
    this.rules = [...BUILTIN_RULES];

    // 从 Mission 配置加载额外规则
    for (const pattern of config.risk_policy.block) {
      this.rules.push({
        pattern: new RegExp(pattern.replace(/\*/g, ".*"), "i"),
        level: "CRITICAL",
        action: "block",
        message: `Mission 策略: 禁止 "${pattern}"`,
      });
    }
    for (const pattern of config.risk_policy.require_approval) {
      this.rules.push({
        pattern: new RegExp(pattern.replace(/\*/g, ".*"), "i"),
        level: "HIGH",
        action: "require_approval",
        message: `Mission 策略: "${pattern}" 需要确认`,
      });
    }
  }

  /**
   * 评估操作风险
   */
  assess(command: string, workingDir: string): RiskAssessment {
    // 检查是否超出工作目录
    if (command.includes(workingDir) === false && 
        (command.includes("rm ") || command.includes("mv ") || command.includes("cp "))) {
      // 简单判断：操作路径不包含工作目录 → 可能需要关注
      // 更精确的检查留给 Phase 3+
    }

    // 匹配风险规则
    for (const rule of this.rules) {
      if (rule.pattern.test(command)) {
        return {
          level: rule.level,
          action: rule.action,
          reason: rule.message,
          blocked: rule.action === "block",
        };
      }
    }

    // 默认：低风险
    return {
      level: "LOW",
      action: "allow",
      reason: "低风险操作",
      blocked: false,
    };
  }

  /**
   * 批量评估
   */
  assessBatch(commands: string[], workingDir: string): RiskAssessment[] {
    return commands.map(cmd => this.assess(cmd, workingDir));
  }

  /**
   * 批量评估中最严重的等级
   */
  highestRisk(assessments: RiskAssessment[]): RiskAssessment {
    const order: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    let worst = assessments[0];
    for (const a of assessments) {
      if (order.indexOf(a.level) > order.indexOf(worst.level)) {
        worst = a;
      }
    }
    return worst;
  }

  /**
   * 是否有被阻断的操作
   */
  hasBlocked(assessments: RiskAssessment[]): boolean {
    return assessments.some(a => a.blocked);
  }

  /**
   * 是否需要审批（有 HIGH 或 CRITICAL）
   */
  needsApproval(assessments: RiskAssessment[]): boolean {
    return assessments.some(a => a.action === "require_approval" || a.action === "block");
  }
}
