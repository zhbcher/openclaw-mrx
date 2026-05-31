/**
 * ECC Agent Adapter
 * 
 * 将 ECC Agent 定义适配为 MRX 的 AgentAdapter，
 * 使 MRX 在执行任务时能够「化身」为特定的专业角色。
 */

import { ECCAgent, ECCRuleLoader } from "./rule-loader.js";

/**
 * ECC Agent 执行上下文
 */
export interface ECCAgentContext {
  agentId: string;
  agentName: string;
  systemPrompt: string;
  guidelines: string;
  diagnosticCommands: string[];
  reviewPriorities: string[];
}

/**
 * ECC Agent 适配器
 */
export class ECCAgentAdapter {
  private loader: ECCRuleLoader;
  private currentAgent?: ECCAgent;

  constructor(loader: ECCRuleLoader) {
    this.loader = loader;
  }

  /**
   * 根据关键词选择合适的 Agent
   */
  selectAgent(keywords: string[]): ECCAgent | undefined {
    const agent = this.loader.matchAgent(keywords);
    if (agent) {
      this.currentAgent = agent;
      console.log(`  🤖 选择 ECC Agent: ${agent.name} (${agent.id})`);
    }
    return agent;
  }

  /**
   * 获取当前选择的 Agent
   */
  getCurrentAgent(): ECCAgent | undefined {
    return this.currentAgent;
  }

  /**
   * 为 Agent 构建执行上下文
   */
  buildAgentContext(agent: ECCAgent): ECCAgentContext {
    const systemPrompt = this.extractSystemPrompt(agent.content);
    const guidelines = this.extractGuidelines(agent.content);
    const diagnosticCommands = this.extractDiagnosticCommands(agent.content);
    const reviewPriorities = this.extractReviewPriorities(agent.content);

    return {
      agentId: agent.id,
      agentName: agent.name,
      systemPrompt,
      guidelines,
      diagnosticCommands,
      reviewPriorities,
    };
  }

  /**
   * 生成 Agent 的完整 System Prompt
   */
  generateSystemPrompt(agent: ECCAgent): string {
    const sections: string[] = [];

    // 代理身份
    sections.push(`You are the ${agent.name} agent.`);
    sections.push(`Purpose: ${agent.description}`);
    sections.push("");

    // 防御基线
    const defense = this.extractSection(agent.content, "Prompt Defense Baseline");
    if (defense) {
      sections.push("## Security & Defense");
      sections.push(defense);
      sections.push("");
    }

    // 审查优先级
    const priorities = this.extractSection(agent.content, "Review Priorities");
    if (priorities) {
      sections.push("## Review Priorities");
      sections.push(priorities);
      sections.push("");
    }

    // 诊断命令
    const diagnostics = this.extractSection(agent.content, "Diagnostic Commands");
    if (diagnostics) {
      sections.push("## Diagnostic Commands");
      sections.push(diagnostics);
      sections.push("");
    }

    // 批准标准
    const approval = this.extractSection(agent.content, "Approval Criteria");
    if (approval) {
      sections.push("## Approval Criteria");
      sections.push(approval);
      sections.push("");
    }

    return sections.join("\n");
  }

  /**
   * 获取 Agent 的诊断命令
   */
  getDiagnosticCommands(agent: ECCAgent): string[] {
    const commands: string[] = [];
    const section = this.extractSection(agent.content, "Diagnostic Commands");
    
    if (section) {
      const lines = section.split("\n");
      for (const line of lines) {
        const match = line.match(/^```bash\n([\s\S]*?)\n```/) || 
                     line.match(/^\s*-\s*`(.+?)`/);
        if (match) {
          const cmd = match[1];
          if (cmd && !commands.includes(cmd)) {
            commands.push(cmd);
          }
        }
      }
    }

    return commands;
  }

  /**
   * 获取 Agent 的审查优先级
   */
  getReviewPriorities(agent: ECCAgent): Record<string, string[]> {
    const priorities: Record<string, string[]> = {};
    const section = this.extractSection(agent.content, "Review Priorities");

    if (section) {
      let currentLevel = "";
      const lines = section.split("\n");

      for (const line of lines) {
        // 检查优先级标题（如 "### CRITICAL -- Security"）
        const levelMatch = line.match(/^###\s+([A-Z]+)\s*--?\s*(.+)/);
        if (levelMatch) {
          currentLevel = levelMatch[1];
          priorities[currentLevel] = [];
          continue;
        }

        // 提取优先级下的项目
        if (currentLevel && line.startsWith("-")) {
          const item = line.replace(/^-\s*/, "").trim();
          if (item) {
            priorities[currentLevel].push(item);
          }
        }
      }
    }

    return priorities;
  }

  /**
   * 列出所有可用的 Agent
   */
  listAgents() {
    return this.loader.listAgents();
  }

  /**
   * 提取 System Prompt
   */
  private extractSystemPrompt(content: string): string {
    // 查找 "You are" 开头的段落
    const lines = content.split("\n");
    const systemLines: string[] = [];
    let inSystem = false;

    for (const line of lines) {
      if (line.startsWith("You are")) {
        inSystem = true;
      }

      if (inSystem) {
        if (line.startsWith("##") || line.startsWith("---")) {
          break;
        }
        systemLines.push(line);
      }
    }

    return systemLines.join("\n").trim();
  }

  /**
   * 提取指导原则
   */
  private extractGuidelines(content: string): string {
    const sections: string[] = [];

    // 提取防御基线
    const defense = this.extractSection(content, "Prompt Defense Baseline");
    if (defense) {
      sections.push("### Defense Baseline");
      sections.push(defense);
    }

    // 提取审查优先级摘要
    const priorities = this.extractSection(content, "Review Priorities");
    if (priorities) {
      const lines = priorities.split("\n").slice(0, 10);
      sections.push("### Review Priorities");
      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }

  /**
   * 提取诊断命令
   */
  private extractDiagnosticCommands(content: string): string[] {
    const commands: string[] = [];
    const section = this.extractSection(content, "Diagnostic Commands");

    if (section) {
      const codeBlocks = section.match(/```bash\n([\s\S]*?)\n```/g) || [];
      for (const block of codeBlocks) {
        const match = block.match(/```bash\n([\s\S]*?)\n```/);
        if (match) {
          const lines = match[1].split("\n").filter(l => l.trim() && !l.startsWith("#"));
          commands.push(...lines);
        }
      }
    }

    return commands;
  }

  /**
   * 提取审查优先级
   */
  private extractReviewPriorities(content: string): string[] {
    const priorities: string[] = [];
    const section = this.extractSection(content, "Review Priorities");

    if (section) {
      const lines = section.split("\n");
      for (const line of lines) {
        const match = line.match(/^###\s+([A-Z]+)\s*--?\s*(.+)/);
        if (match) {
          priorities.push(`${match[1]}: ${match[2]}`);
        }
      }
    }

    return priorities;
  }

  /**
   * 从内容中提取特定部分
   */
  private extractSection(content: string, sectionName: string): string {
    const regex = new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
    const match = content.match(regex);
    return match ? match[1].trim() : "";
  }
}
