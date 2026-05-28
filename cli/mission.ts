#!/usr/bin/env node
/**
 * MRX CLI — Mission Runtime 命令行入口
 * 
 * 用法:
 *   mrx create "任务名" --repo ./my-project    创建 Mission 模板
 *   mrx start mission.yaml                     启动 Mission
 *   mrx status                                 查看状态
 *   mrx resume                                 恢复 Mission
 */

import * as path from "path";
import * as fs from "fs";
import { LoopEngine } from "../core/runtime/loop-engine.js";
import { StateManager } from "../core/state/state-manager.js";
import { MissionParser } from "../core/parser/mission-parser.js";
import { CheckpointManager } from "../core/checkpoint/checkpoint.js";

// MRX 项目根目录（源: cli/mission.ts → 编译: dist/cli/mission.js → 回退两层）
const MRX_ROOT = path.resolve(import.meta.dirname, "../..");
const MISSIONS_DIR = path.resolve(process.env.MRX_MISSIONS_DIR || path.join(MRX_ROOT, "missions/active"));
const STORAGE_ROOT = path.resolve(process.env.MRX_STORAGE_ROOT || path.join(MRX_ROOT, "storage"));

function usage(): void {
  console.log(`
MRX — OpenClaw Mission Runtime

用法:
  mrx create <名称> --repo <路径>     创建 Mission 模板
  mrx start <mission.yaml>            启动 Mission
  mrx status [mission-id]             查看 Mission 状态
  mrx resume [mission-id]             恢复 Mission
  mrx checkpoints [mission-id]        查看 Checkpoint 列表
  mrx help                            显示帮助
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "create": {
      const name = args[1];
      const repoIdx = args.indexOf("--repo");
      const repo = repoIdx >= 0 ? args[repoIdx + 1] : ".";

      if (!name) {
        console.log("用法: mrx create <名称> --repo <路径>");
        process.exit(1);
      }

      const yaml = MissionParser.generateTemplate(name, repo);
      const filename = `mission-${name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
      const outputPath = path.resolve(filename);

      if (fs.existsSync(outputPath)) {
        console.log(`❌ 文件已存在: ${outputPath}`);
        process.exit(1);
      }

      fs.writeFileSync(outputPath, yaml, "utf-8");
      console.log(`✅ Mission 模板已创建: ${outputPath}`);
      console.log(`   请编辑此文件，填写 objective / validation / constraints 等字段`);
      break;
    }

    case "start": {
      const configPath = path.resolve(args[1]);
      if (!args[1] || !fs.existsSync(configPath)) {
        console.log(`❌ Mission 配置文件不存在: ${args[1]}`);
        console.log("用法: mrx start <mission.yaml>");
        process.exit(1);
      }

      console.log("═".repeat(50));
      console.log("  OpenClaw Mission Runtime (MRX) — Phase 1 MVP");
      console.log("═".repeat(50));

      // 解析配置以获取 mission id
      const config = MissionParser.fromFile(configPath);
      const missionDir = path.join(MISSIONS_DIR, config.mission.id);

      // 确保目录存在
      if (!fs.existsSync(missionDir)) {
        fs.mkdirSync(missionDir, { recursive: true });
      }
      if (!fs.existsSync(STORAGE_ROOT)) {
        fs.mkdirSync(STORAGE_ROOT, { recursive: true });
      }

      const engine = new LoopEngine({
        configPath,
        missionDir,
        storageRoot: STORAGE_ROOT,
      });
      await engine.start();
      break;
    }

    case "status": {
      const missionId = args[1];
      if (!missionId) {
        // 列出所有 active missions
        if (!fs.existsSync(MISSIONS_DIR)) {
          console.log("无活动 Mission");
          process.exit(0);
        }
        const dirs = fs.readdirSync(MISSIONS_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory());

        if (dirs.length === 0) {
          console.log("无活动 Mission");
          process.exit(0);
        }

        console.log("活动 Mission:");
        for (const dir of dirs) {
          const stateFile = path.join(MISSIONS_DIR, dir.name, "state.yaml");
          if (fs.existsSync(stateFile)) {
            const sm = new StateManager(path.join(MISSIONS_DIR, dir.name));
            const state = sm.load();
            if (state) {
              const icon = state.status === "completed" ? "✅" :
                           state.status === "failed" ? "❌" :
                           state.status === "running" ? "🔄" :
                           state.status === "paused" ? "⏸️" : "📋";
              console.log(`  ${icon} ${dir.name} — ${state.status} | 循环 #${state.current_iteration}`);
            }
          }
        }
      } else {
        const missionDir = path.join(MISSIONS_DIR, missionId);
        const sm = new StateManager(missionDir);
        const state = sm.load();

        if (!state) {
          console.log(`❌ Mission 不存在: ${missionId}`);
          process.exit(1);
        }

        console.log(`Mission: ${missionId}`);
        console.log(`状态: ${state.status}`);
        console.log(`当前循环: #${state.current_iteration}`);
        console.log(`当前阶段: ${state.current_phase}`);
        console.log(`当前任务: ${state.current_task_id || "无"}`);
        console.log(`验证历史: ${state.verification_history.length} 次`);
        console.log(`Token 消耗: ${state.budget_consumed.tokens.toLocaleString()}`);
        if (state.last_checkpoint_id) {
          console.log(`最后 Checkpoint: ${state.last_checkpoint_id}`);
        }
        if (state.last_error) {
          console.log(`最后错误: ${state.last_error}`);
        }
      }
      break;
    }

    case "resume": {
      const missionId = args[1];
      if (!missionId) {
        console.log("用法: mrx resume <mission-id>");
        process.exit(1);
      }

      const missionDir = path.join(MISSIONS_DIR, missionId);
      const sm = new StateManager(missionDir);
      const state = sm.load();

      if (!state) {
        console.log(`❌ Mission 不存在: ${missionId}`);
        process.exit(1);
      }

      const configPath = path.resolve(state.mission_config_path);
      if (!fs.existsSync(configPath)) {
        // 尝试在 mission 目录下找
        const altPath = path.join(missionDir, "mission.yaml");
        if (!fs.existsSync(altPath)) {
          console.log(`❌ 找不到 Mission 配置文件`);
          process.exit(1);
        }
      }

      const engine = new LoopEngine({
        configPath,
        missionDir,
        storageRoot: STORAGE_ROOT,
      });
      await engine.resume();
      break;
    }

    case "checkpoints": {
      const missionId = args[1];
      if (!missionId) {
        console.log("用法: mrx checkpoints <mission-id>");
        process.exit(1);
      }

      const cpm = new CheckpointManager(STORAGE_ROOT, missionId);
      const checkpoints = cpm.listAll();

      if (checkpoints.length === 0) {
        console.log("无 Checkpoint");
        process.exit(0);
      }

      console.log(`Checkpoints for ${missionId}:`);
      for (const cp of checkpoints) {
        console.log(`  📸 ${cp.id} — #${cp.iteration} ${cp.phase} — ${cp.timestamp}`);
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
    default:
      usage();
      break;
  }
}

main().catch(err => {
  console.error("❌ MRX 错误:", err.message);
  process.exit(1);
});
