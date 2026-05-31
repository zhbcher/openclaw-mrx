# MRX + ECC 集成版快速开始

## 🚀 5 分钟快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建项目

```bash
npm run build
```

### 3. 验证 ECC 技能集成

```bash
npm run test:ecc
```

这将显示所有已加载的 ECC 技能，包括龙虾灵魂锻造、搜索优先工作流等 250+ 技能。

### 4. 运行 MRX

```bash
# 创建一个新的目标
npx tsx cli/mrx-skeleton.ts run "构建一个股票交易系统"

# 查看目标状态
npx tsx cli/mrx-skeleton.ts status <objective_id>

# 列出所有目标
npx tsx cli/mrx-skeleton.ts list
```

## 📚 核心概念

### 什么是 ECC 技能？

ECC 技能是预定义的、可重用的工作流和工具。每个技能都包含 SKILL.md 定义和对应的脚本实现。

### 如何在 MRX 中使用 ECC 技能？

在 MRX 的任务执行中，创建类型为 `ecc_skill` 的任务即可调用 ECC 技能。

## 📖 详细文档

- **ECC 集成详细指南**：[ECC-INTEGRATION.md](./ECC-INTEGRATION.md)
- **MRX 原始教程**：[TUTORIAL.zh-CN.md](./TUTORIAL.zh-CN.md)
- **MRX 架构文档**：[docs/ARCHITECTURE-FREEZE.md](./docs/ARCHITECTURE-FREEZE.md)

## 🎯 常见任务

### 列出所有可用的 ECC 技能

```bash
npm run test:ecc
```

### 查看特定技能的详细信息

```bash
cat ecc-skills/<skill-id>/SKILL.md
```

### 创建自定义 ECC 技能

1. 在 `ecc-skills` 目录下创建新目录
2. 创建 `SKILL.md` 文件定义技能
3. 创建实现脚本（Python 或 Shell）
4. 在 MRX 中使用该技能

详见 [ECC-INTEGRATION.md](./ECC-INTEGRATION.md) 中的高级使用部分。

## 🐛 故障排查

### 问题：找不到 ECC 技能

```bash
# 检查 ecc-skills 目录是否存在
ls -la ecc-skills/

# 运行测试查看已加载的技能
npm run test:ecc
```

### 问题：技能执行失败

1. 检查技能的前置条件（SKILL.md 中的 "前置条件" 部分）
2. 确保所需的依赖已安装
3. 查看详细的错误信息

详见 [ECC-INTEGRATION.md](./ECC-INTEGRATION.md) 中的故障排查部分。

## 📦 项目结构

```
openclaw-mrx-ecc-integrated/
├── core/executor/
│   ├── ecc-skill-executor.ts      ✨ ECC 执行器
│   ├── executor-factory.ts        ✨ 执行器工厂
│   └── ...
├── ecc-skills/                    ✨ ECC 技能库（250+ 技能）
├── test/
│   ├── ecc-skill-executor-test.ts ✨ ECC 执行器测试
│   └── ...
├── ECC-INTEGRATION.md             ✨ 集成指南
└── QUICKSTART-ECC.md              ✨ 本文档
```

## 💡 提示

- 每个 ECC 技能都有详细的 `SKILL.md` 文档
- 可以在 `ecc-skills` 目录中浏览所有可用的技能
- 技能可以链式调用，形成复杂的工作流
- 使用 `npm run test:ecc` 定期验证技能的可用性

---

**需要帮助？** 查看 [ECC-INTEGRATION.md](./ECC-INTEGRATION.md)。
