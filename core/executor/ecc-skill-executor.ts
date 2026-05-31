/**
 * ECC Skill Executor — 集成 ECC 技能到 MRX 执行器
 * 
 * 此执行器能够发现、解析和执行 ECC 技能库中的各类技能。
 * ECC 技能通过 SKILL.md 文件定义，可能涉及 Python、Shell 脚本或其他可执行文件。
 */

import { execSync, spawn } from "child_process";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { Executor, ExecutorAction, TaskInput, TaskResult } from "./executor.js";

/**
 * ECC 技能的元数据
 */
interface ECCSkillMetadata {
  id: string;                    // 技能目录名称
  name: string;                  // SKILL.md 中的 name
  description: string;           // 技能描述
  skillDir: string;              // 技能目录的完整路径
  skillMdPath: string;           // SKILL.md 的完整路径
  scripts: string[];             // 技能目录中的可执行脚本
  origin?: string;               // 技能来源（如 community）
}

/**
 * ECC Skill Executor — 执行 ECC 技能
 */
export class ECCSkillExecutor implements Executor {
  readonly name = "ecc-skill-executor";
  private skills: Map<string, ECCSkillMetadata> = new Map();
  private eccSkillsDir: string;
  private initialized = false;

  constructor(eccSkillsDir?: string) {
    // 默认 ECC 技能目录为项目根目录下的 ecc-skills
    this.eccSkillsDir = eccSkillsDir || resolve(process.cwd(), "ecc-skills");
  }

  /**
   * 初始化：扫描并解析所有 ECC 技能
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!existsSync(this.eccSkillsDir)) {
      console.warn(`⚠️  ECC 技能目录不存在: ${this.eccSkillsDir}`);
      this.initialized = true;
      return;
    }

    try {
      const skillDirs = readdirSync(this.eccSkillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const skillId of skillDirs) {
        const skillDir = join(this.eccSkillsDir, skillId);
        const skillMdPath = join(skillDir, "SKILL.md");

        if (existsSync(skillMdPath)) {
          try {
            const metadata = this.parseSkillMetadata(skillId, skillDir, skillMdPath);
            this.skills.set(skillId, metadata);
            console.log(`✅ 已加载 ECC 技能: ${skillId}`);
          } catch (err) {
            console.warn(`⚠️  无法解析技能 ${skillId}: ${err}`);
          }
        }
      }

      this.initialized = true;
      console.log(`✅ ECC Skill Executor 已初始化，共加载 ${this.skills.size} 个技能`);
    } catch (err) {
      console.error(`❌ 初始化 ECC Skill Executor 失败: ${err}`);
      this.initialized = true;
    }
  }

  /**
   * 从 SKILL.md 解析技能元数据
   */
  private parseSkillMetadata(skillId: string, skillDir: string, skillMdPath: string): ECCSkillMetadata {
    const content = readFileSync(skillMdPath, "utf-8");

    // 提取 frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let name = skillId;
    let description = "";
    let origin = "";

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*"(.+?)"/);
      const originMatch = frontmatter.match(/origin:\s*(.+)/);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
      if (originMatch) origin = originMatch[1].trim();
    }

    // 扫描技能目录中的可执行脚本
    const scripts: string[] = [];
    try {
      const files = readdirSync(skillDir);
      for (const file of files) {
        const filePath = join(skillDir, file);
        // 检查是否为 Python、Shell 或其他可执行脚本
        if (file.endsWith(".py") || file.endsWith(".sh") || file.match(/^[a-zA-Z0-9_-]+$/) && !file.includes(".")) {
          scripts.push(file);
        }
      }
    } catch (err) {
      // 忽略错误
    }

    return {
      id: skillId,
      name,
      description,
      skillDir,
      skillMdPath,
      scripts,
      origin,
    };
  }

  /**
   * 检查此执行器能否处理该 action
   */
  canHandle(action: ExecutorAction): boolean {
    return (action.type as any) === "ecc_skill";
  }

  /**
   * 执行 ECC 技能
   */
  async execute(input: TaskInput): Promise<TaskResult> {
    const { action, workingDir } = input;
    const started = Date.now();

    try {
      // 确保已初始化
      if (!this.initialized) {
        await this.initialize();
      }

      // 获取技能名称
      const skillId = action.target;
      const skill = this.skills.get(skillId);

      if (!skill) {
        return {
          success: false,
          output: "",
          error: `ECC 技能不存在: ${skillId}。可用技能: ${Array.from(this.skills.keys()).join(", ")}`,
          durationMs: Date.now() - started,
          action,
        };
      }

      // 解析参数
      let params: Record<string, any> = {};
      if (action.content) {
        try {
          params = JSON.parse(action.content);
        } catch (err) {
          return {
            success: false,
            output: "",
            error: `无效的 JSON 参数: ${action.content}`,
            durationMs: Date.now() - started,
            action,
          };
        }
      }

      // 执行技能
      const result = await this.executeSkill(skill, params, workingDir);

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: Date.now() - started,
        action,
      };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `执行 ECC 技能时发生错误: ${err.message}`,
        durationMs: Date.now() - started,
        action,
      };
    }
  }

  /**
   * 执行具体的 ECC 技能
   */
  private async executeSkill(
    skill: ECCSkillMetadata,
    params: Record<string, any>,
    workingDir: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    // 优先查找 Python 脚本
    const pythonScript = skill.scripts.find(s => s.endsWith(".py"));
    const shellScript = skill.scripts.find(s => s.endsWith(".sh"));

    try {
      if (pythonScript) {
        return await this.executePythonScript(
          join(skill.skillDir, pythonScript),
          params,
          workingDir
        );
      } else if (shellScript) {
        return await this.executeShellScript(
          join(skill.skillDir, shellScript),
          params,
          workingDir
        );
      } else {
        // 如果没有脚本，尝试直接执行技能目录中的主要可执行文件
        if (skill.scripts.length > 0) {
          const mainScript = join(skill.skillDir, skill.scripts[0]);
          return await this.executeShellScript(mainScript, params, workingDir);
        } else {
          return {
            success: false,
            output: "",
            error: `技能 ${skill.id} 中没有找到可执行脚本`,
          };
        }
      }
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: `执行技能脚本时发生错误: ${err.message}`,
      };
    }
  }

  /**
   * 执行 Python 脚本
   */
  private async executePythonScript(
    scriptPath: string,
    params: Record<string, any>,
    workingDir: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      try {
        // 构造命令行参数
        const args: string[] = [scriptPath];

        // 如果有参数，将其作为命令行参数传递
        if (Object.keys(params).length > 0) {
          // 对于简单的参数，直接添加到命令行
          for (const [key, value] of Object.entries(params)) {
            if (typeof value === "string" || typeof value === "number") {
              args.push(`--${key}`, String(value));
            }
          }
        }

        const process = spawn("python3", args, {
          cwd: workingDir,
          timeout: 300000, // 5 分钟超时
        });

        let output = "";
        let errorOutput = "";

        process.stdout?.on("data", (data) => {
          output += data.toString();
        });

        process.stderr?.on("data", (data) => {
          errorOutput += data.toString();
        });

        process.on("close", (code) => {
          if (code === 0) {
            resolve({
              success: true,
              output: output.slice(0, 10000), // 限制输出大小
            });
          } else {
            resolve({
              success: false,
              output: output.slice(0, 5000),
              error: errorOutput.slice(0, 5000) || `脚本退出码: ${code}`,
            });
          }
        });

        process.on("error", (err) => {
            resolve({
              success: false,
              output: "",
              error: `执行 Python 脚本失败: ${err.message}`,
            });
        });
      } catch (err: any) {
        resolve({
          success: false,
          output: "",
          error: `执行 Python 脚本时发生异常: ${err.message}`,
        });
      }
    });
  }

  /**
   * 执行 Shell 脚本
   */
  private async executeShellScript(
    scriptPath: string,
    params: Record<string, any>,
    workingDir: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      try {
        // 构造命令行参数
        let command = `bash ${scriptPath}`;

        // 如果有参数，将其作为命令行参数传递
        if (Object.keys(params).length > 0) {
          for (const [key, value] of Object.entries(params)) {
            if (typeof value === "string" || typeof value === "number") {
              command += ` --${key} "${value}"`;
            }
          }
        }

        const process = spawn("bash", ["-c", command], {
          cwd: workingDir,
          timeout: 300000, // 5 分钟超时
        });

        let output = "";
        let errorOutput = "";

        process.stdout?.on("data", (data) => {
          output += data.toString();
        });

        process.stderr?.on("data", (data) => {
          errorOutput += data.toString();
        });

        process.on("close", (code) => {
          if (code === 0) {
            resolve({
              success: true,
              output: output.slice(0, 10000), // 限制输出大小
            });
          } else {
            resolve({
              success: false,
              output: output.slice(0, 5000),
              error: errorOutput.slice(0, 5000) || `脚本退出码: ${code}`,
            });
          }
        });

        process.on("error", (err) => {
          resolve({
            success: false,
            output: "",
            error: `执行 Shell 脚本失败: ${err.message}`,
          });
        });
      } catch (err: any) {
        resolve({
          success: false,
          output: "",
          error: `执行 Shell 脚本时发生异常: ${err.message}`,
        });
      }
    });
  }

  /**
   * 列出所有可用的 ECC 技能
   */
  listSkills(): Array<{ id: string; name: string; description: string }> {
    return Array.from(this.skills.values()).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * 获取特定技能的详细信息
   */
  getSkillInfo(skillId: string): ECCSkillMetadata | undefined {
    return this.skills.get(skillId);
  }
}
