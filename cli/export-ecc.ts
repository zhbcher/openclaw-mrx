#!/usr/bin/env node

/**
 * 跨 Harness 导出工具 — MRX Agent → ECC 兼容格式
 * 
 * 将 MRX 的 agent 定义、skill prompt 导出为 ECC 兼容的 Markdown 格式，
 * 可在 Claude Code、Codex、Cursor、OpenCode 等 harness 中使用。
 * 
 * 用法：
 *   npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export
 *   npx tsx cli/export-ecc.ts --agents-all --output ./ecc-export
 *   npx tsx cli/export-ecc.ts --help
 */

import * as fs from "fs";
import * as path from "path";

interface ExportOptions {
  agentId?: string;
  exportAll?: boolean;
  outputDir: string;
  format: "ecc" | "claude-code" | "codex";
}

function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    outputDir: "./ecc-export",
    format: "ecc",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--agent":
        options.agentId = args[++i];
        break;
      case "--agents-all":
        options.exportAll = true;
        break;
      case "--output":
        options.outputDir = args[++i];
        break;
      case "--format":
        options.format = args[++i] as ExportOptions["format"];
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  if (!options.agentId && !options.exportAll) {
    console.error("❌ 请指定 --agent 或 --agents-all");
    printHelp();
    process.exit(1);
  }

  return options;
}

function printHelp(): void {
  console.log(`
MRX → ECC 跨 Harness 导出工具

用法:
  --agent <name>       导出指定 Agent（如 security-reviewer）
  --agents-all         导出所有 Agent
  --output <dir>       输出目录（默认 ./ecc-export）
  --format <type>      输出格式: ecc | claude-code | codex（默认 ecc）
  --help               显示帮助

示例:
  npx tsx cli/export-ecc.ts --agent security-reviewer --output ./ecc-export
  npx tsx cli/export-ecc.ts --agents-all --format claude-code
`);
}

/**
 * 从 MRX Agent 定义生成 ECC 兼容格式
 */
function generateECCAgent(agentId: string, sourcePath: string): string {
  const content = fs.readFileSync(sourcePath, "utf-8");

  // 解析 YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const metadata: Record<string, any> = {};
  let bodyMd = content;

  if (frontmatterMatch) {
    bodyMd = content.slice(frontmatterMatch[0].length).trim();
    const yaml = frontmatterMatch[1];
    for (const line of yaml.split("\n")) {
      const [key, ...valueParts] = line.split(":");
      if (key) {
        let value = valueParts.join(":").trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          try { value = JSON.stringify(JSON.parse(value)); } catch {}
        }
        metadata[key.trim()] = value;
      }
    }
  }

  // 输出 ECC 兼容格式
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: mrx-${agentId}`);
  lines.push(`description: "MRX 导出 Agent — ${bodyMd.split("\n")[0]?.replace(/^#\s*/, "") || agentId}"`);
  if (metadata.tools) {
    const tools = Array.isArray(metadata.tools) ? metadata.tools : 
      metadata.tools.replace(/[[\]"']/g, "").split(",").map((s: string) => s.trim());
    lines.push(`tools: [${tools.join(", ")}]`);
  }
  lines.push(`origin: mrx`);
  lines.push(`source: openclaw-mrx.${agentId}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${agentId} (MRX 导出)`);
  lines.push("");
  lines.push(bodyMd);

  return lines.join("\n");
}

/**
 * 生成 Claude Code 兼容格式
 */
function generateClaudeCodeAgent(agentId: string, sourcePath: string): string {
  const content = fs.readFileSync(sourcePath, "utf-8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const bodyMd = frontmatterMatch ? content.slice(frontmatterMatch[0].length).trim() : content;

  return `# ${agentId}
# Claude Code 导入 — 来自 MRX/OpenClaw

${bodyMd}

---
# 使用方式:
# 1. 将此文件放入 ~/.claude/agents/
# 2. 在 Claude Code 中通过 /claude-agent ${agentId} 调用
`;
}

/**
 * 生成 Codex 兼容格式
 */
function generateCodexAgent(agentId: string, sourcePath: string): string {
  const content = fs.readFileSync(sourcePath, "utf-8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const bodyMd = frontmatterMatch ? content.slice(frontmatterMatch[0].length).trim() : content;

  return bodyMd;
}

function main(): void {
  const options = parseArgs();
  const eccAgentsDir = path.join(process.cwd(), "ecc-assets", "agents");
  const mrxAgentsDir = path.join(process.cwd(), "agents");

  if (!fs.existsSync(eccAgentsDir) && !fs.existsSync(mrxAgentsDir)) {
    console.error("❌ 未找到 Agent 目录（ecc-assets/agents/ 或 agents/）");
    process.exit(1);
  }

  // 确定输出目录
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // 确定要导出的 Agent 列表
  const agentIds: string[] = [];
  if (options.exportAll) {
    // 从 ecc-assets/agents 和 agents/ 目录收集
    const dirs = [eccAgentsDir, mrxAgentsDir].filter(d => fs.existsSync(d));
    for (const dir of dirs) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
      agentIds.push(...files.map(f => f.replace(".md", "")));
    }
    // 去重
    const unique = new Set(agentIds);
    agentIds.length = 0;
    agentIds.push(...unique);
  } else if (options.agentId) {
    agentIds.push(options.agentId);
  }

  if (agentIds.length === 0) {
    console.error("❌ 未找到任何 Agent");
    process.exit(1);
  }

  // 生成每个 Agent
  let exportedCount = 0;
  for (const agentId of agentIds) {
    // 查找 Agent 源文件
    let sourcePath = path.join(eccAgentsDir, `${agentId}.md`);
    if (!fs.existsSync(sourcePath)) {
      sourcePath = path.join(mrxAgentsDir, `${agentId}.md`);
    }
    if (!fs.existsSync(sourcePath)) {
      console.warn(`  ⚠️  未找到 Agent: ${agentId}，跳过`);
      continue;
    }

    let output: string;
    let ext: string;

    switch (options.format) {
      case "claude-code":
        output = generateClaudeCodeAgent(agentId, sourcePath);
        ext = ".md";
        break;
      case "codex":
        output = generateCodexAgent(agentId, sourcePath);
        ext = ".md";
        break;
      case "ecc":
      default:
        output = generateECCAgent(agentId, sourcePath);
        ext = ".md";
        break;
    }

    const outFile = path.join(outputDir, `${agentId}${ext}`);
    fs.writeFileSync(outFile, output, "utf-8");
    console.log(`  ✅ 已导出: ${agentId} → ${outFile}`);
    exportedCount++;
  }

  console.log(`\n📦 导出完成: ${exportedCount}/${agentIds.length} 个 Agent → ${outputDir}`);
  console.log(`   格式: ${options.format}`);
  console.log(`   提示: 将导出文件复制到目标 harness 的工作目录即可使用`);
}

main();
