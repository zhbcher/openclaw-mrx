/**
 * Executor Factory — 创建和注册所有执行器
 * 
 * 此工厂集中管理所有执行器的创建和注册，包括原生 MRX 执行器和 ECC 技能执行器。
 */

import { CommandExecutor } from "./command-executor.js";
import { FileExecutor } from "./file-executor.js";
import { ToolExecutor, createDefaultTools } from "./tool-executor.js";
import { ECCSkillExecutor } from "./ecc-skill-executor.js";
import { ExecutorRegistry } from "./executor-registry.js";
import * as path from "path";

/**
 * 创建完整的执行器注册表
 * 
 * @param workingDir - 工作目录
 * @param eccSkillsDir - ECC 技能目录（可选）
 * @returns 配置好的 ExecutorRegistry
 */
export async function createExecutorRegistry(
  workingDir: string,
  eccSkillsDir?: string
): Promise<ExecutorRegistry> {
  const registry = new ExecutorRegistry();

  // 注册原生 MRX 执行器
  registry.register(new CommandExecutor(workingDir));
  registry.register(new FileExecutor(workingDir));
  registry.register(new ToolExecutor(createDefaultTools()));

  // 注册 ECC 技能执行器
  const eccExecutor = new ECCSkillExecutor(
    eccSkillsDir || path.join(process.cwd(), "ecc-skills")
  );
  await eccExecutor.initialize();
  registry.register(eccExecutor);

  console.log(`✅ 执行器注册表已初始化，共 ${registry.list().length} 个执行器`);
  console.log(`   注册的执行器: ${registry.list().join(", ")}`);

  return registry;
}

/**
 * 获取 ECC 技能执行器
 * 
 * @param registry - 执行器注册表
 * @returns ECC 技能执行器，如果不存在则返回 undefined
 */
export function getECCSkillExecutor(registry: ExecutorRegistry): ECCSkillExecutor | undefined {
  // 由于 ExecutorRegistry 不提供直接获取执行器的方法，
  // 我们需要在工厂中保存引用或修改 ExecutorRegistry 的设计
  // 这里提供一个简化的实现
  return undefined; // TODO: 需要修改 ExecutorRegistry 以支持此功能
}

export { ECCSkillExecutor };
