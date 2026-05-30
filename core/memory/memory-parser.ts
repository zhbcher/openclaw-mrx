/**
 * Shared Memory Parser — 所有模块共用的 Markdown → MemoryEntry 解析
 * 
 * 消除 recall-engine / qmd-lite-client / hybrid-recall-engine 三处重复逻辑。
 */

import type { MemoryEntry } from "./memory-compiler.js";

/**
 * 解析 Memory Compiler 输出的 Markdown 文件为 MemoryEntry 列表
 * @param content Markdown 内容
 * @param type 记忆类型（单数: decision/failure/solution/pattern/knowledge）
 * @param missionId 所属 Mission ID
 */
export function parseMemoryMarkdown(
  content: string,
  type: string,
  missionId: string
): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const normalizedType = normalizeType(type);

  // 按 ## 标题分割
  const sections = content.split(/^## /m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const title = lines[0].trim();
    if (!title || title.startsWith("#")) continue;

    let tags: string[] = [];
    let confidence = 0.7;
    let timestamp = new Date().toISOString();
    const contentLines: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("- **标签**:")) {
        tags = line.replace("- **标签**:", "").trim().split(",").map(t => t.trim());
      } else if (line.startsWith("- **可信度**:")) {
        const pct = parseInt(line.replace("- **可信度**:", "").trim());
        confidence = isNaN(pct) ? 0.7 : pct / 100;
      } else if (line.startsWith("- **时间**:")) {
        timestamp = line.replace("- **时间**:", "").trim();
      } else if (line && !line.startsWith("---") && !line.startsWith("- **") && !line.startsWith("> ")) {
        contentLines.push(line);
      }
    }

    entries.push({
      id: `mem_${missionId}_${normalizedType}_${entries.length}`,
      type: normalizedType,
      mission_id: missionId,
      timestamp,
      title,
      content: contentLines.join("\n").trim(),
      tags,
      confidence,
    });
  }

  return entries;
}

/**
 * 复数 → 单数类型名转换
 */
export function normalizeType(type: string): MemoryEntry["type"] {
  const map: Record<string, MemoryEntry["type"]> = {
    "decisions": "decision",
    "failures": "failure",
    "solutions": "solution",
    "patterns": "pattern",
    "knowledge": "knowledge",
  };
  return map[type] || "knowledge";
}
