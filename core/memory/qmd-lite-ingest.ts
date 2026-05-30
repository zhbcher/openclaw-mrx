/**
 * QMD Lite Ingest — Memory Compiler 输出 → QMD 索引路径
 * 
 * 职责：
 *   1. 将 MemoryEntry[] 写入 memory/mrx/{missionId}/ 目录
 *   2. 写入后自动被 QMD 的 BM25 索引纳入
 *   3. 支持增量追加（同一 Mission 多次编译）
 */

import * as fs from "fs";
import * as path from "path";
import type { MemoryEntry, CompiledMemory } from "./memory-compiler.js";

export class QmdLiteIngest {
  private basePath: string;

  constructor(basePath?: string) {
    // 默认路径：workspace 下的 memory/mrx/
    this.basePath = basePath || path.join(process.cwd(), "memory", "mrx");
  }

  /**
   * 将编译后的记忆写入 QMD 索引路径
   */
  ingest(missionId: string, memory: CompiledMemory): { 
    filesWritten: number; 
    entriesCount: number;
    path: string;
  } {
    const missionDir = path.join(this.basePath, missionId);
    if (!fs.existsSync(missionDir)) {
      fs.mkdirSync(missionDir, { recursive: true });
    }

    let filesWritten = 0;
    let entriesCount = 0;

    // 分类型写入
    const typeMap: Array<{ key: keyof CompiledMemory; file: string }> = [
      { key: "decisions", file: "decisions.md" },
      { key: "failures", file: "failures.md" },
      { key: "solutions", file: "solutions.md" },
      { key: "patterns", file: "patterns.md" },
      { key: "knowledge", file: "knowledge.md" },
    ];

    for (const { key, file } of typeMap) {
      const entries = memory[key];
      if (entries.length === 0) continue;

      const filePath = path.join(missionDir, file);
      const content = this.formatAsMarkdown(key, entries, missionId);
      fs.writeFileSync(filePath, content, "utf-8");
      filesWritten++;
      entriesCount += entries.length;
    }

    // 写入索引文件
    const indexPath = path.join(missionDir, "INDEX.md");
    const indexContent = this.buildIndex(memory, missionId);
    fs.writeFileSync(indexPath, indexContent, "utf-8");
    filesWritten++;

    return {
      filesWritten,
      entriesCount,
      path: missionDir,
    };
  }

  /**
   * 追加单条记忆（增量更新）
   */
  append(missionId: string, entry: MemoryEntry): void {
    const missionDir = path.join(this.basePath, missionId);
    if (!fs.existsSync(missionDir)) {
      fs.mkdirSync(missionDir, { recursive: true });
    }

    const typeFile = `${entry.type}s.md`; // type 是单数，文件名是复数
    const filePath = path.join(missionDir, typeFile);

    const entryText = this.formatEntry(entry);
    
    if (fs.existsSync(filePath)) {
      // 追加到现有文件
      fs.appendFileSync(filePath, "\n" + entryText, "utf-8");
    } else {
      // 创建新文件
      const header = this.fileHeader(entry.type + "s");
      fs.writeFileSync(filePath, header + entryText, "utf-8");
    }
  }

  private formatAsMarkdown(type: string, entries: MemoryEntry[], missionId: string): string {
    const typeLabels: Record<string, string> = {
      decisions: "决策记录",
      failures: "失败记录",
      solutions: "解决方案",
      patterns: "模式识别",
      knowledge: "项目知识",
    };

    const lines = [
      `# ${typeLabels[type] || type}`,
      "",
      `> Mission: ${missionId} | ${entries.length} 条 | 自动编译`,
      "",
    ];

    for (const entry of entries) {
      lines.push(`## ${entry.title}`);
      lines.push("");
      lines.push(`- **时间**: ${entry.timestamp}`);
      lines.push(`- **标签**: ${entry.tags.join(", ")}`);
      lines.push(`- **可信度**: ${Math.round(entry.confidence * 100)}%`);
      lines.push("");
      lines.push(entry.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  private formatEntry(entry: MemoryEntry): string {
    return [
      `## ${entry.title}`,
      "",
      `- **时间**: ${entry.timestamp}`,
      `- **标签**: ${entry.tags.join(", ")}`,
      `- **可信度**: ${Math.round(entry.confidence * 100)}%`,
      "",
      entry.content,
      "",
      "---",
      "",
    ].join("\n");
  }

  private fileHeader(type: string): string {
    return `# ${type}\n\n> 自动编译\n\n`;
  }

  private buildIndex(memory: CompiledMemory, missionId: string): string {
    const lines = [`# Mission 记忆索引`, "", `> Mission: ${missionId} | QMD 索引`, ""];

    const sections: Array<{ key: keyof CompiledMemory; label: string; icon: string }> = [
      { key: "decisions", label: "决策记录", icon: "🧭" },
      { key: "failures", label: "失败记录", icon: "❌" },
      { key: "solutions", label: "解决方案", icon: "💡" },
      { key: "patterns", label: "模式识别", icon: "🔄" },
      { key: "knowledge", label: "项目知识", icon: "📚" },
    ];

    for (const { key, label, icon } of sections) {
      const entries = memory[key];
      lines.push(`## ${icon} ${label} (${entries.length})`);
      for (const entry of entries) {
        const tagPreview = entry.tags.slice(0, 3).join(", ");
        lines.push(`- ${entry.title} \`${tagPreview}\``);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 检查某 Mission 是否已有记忆
   */
  hasMemory(missionId: string): boolean {
    const dir = path.join(this.basePath, missionId);
    return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith(".md"));
  }
}
