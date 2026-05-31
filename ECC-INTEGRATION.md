# MRX + ECC 集成指南

## 概述

此版本的 MRX 已经与 ECC (affaan-m/ECC) 深度融合，使得 MRX 智能体能够发现、理解并执行 ECC 定义的各类技能。这大大扩展了 MRX 的功能边界。

## 新增功能

### 1. ECCSkillExecutor

新增的 `ECCSkillExecutor` 是一个 MRX 执行器，能够：

- **技能发现**：自动扫描 `ecc-skills` 目录，发现所有可用的 ECC 技能。
- **技能解析**：从每个技能的 `SKILL.md` 文件解析元数据（名称、描述、脚本等）。
- **技能执行**：根据 MRX 的任务请求，调用相应的 ECC 技能脚本（Python 或 Shell）。
- **错误处理**：捕获和处理执行过程中的错误，并提供详细的错误信息。

### 2. 集成的 ECC 技能库

项目中包含了 ECC 的完整技能库（位于 `ecc-skills` 目录），包括：

- **openclaw-persona-forge**：龙虾灵魂锻造工具
- **search-first**：搜索优先的工作流
- **verification-loop**：验证循环工具
- **以及 200+ 其他技能**

## 使用方法

### 基本使用

#### 1. 安装依赖

```bash
npm install
```

#### 2. 运行 MRX

```bash
# 运行 MRX CLI
npx tsx cli/mrx-skeleton.ts run "您的目标描述"

# 查看目标状态
npx tsx cli/mrx-skeleton.ts status <objective_id>

# 列出所有目标
npx tsx cli/mrx-skeleton.ts list
```

#### 3. 在任务中使用 ECC 技能

在 MRX 的任务分解中，可以创建类型为 `ecc_skill` 的任务来调用 ECC 技能：

```typescript
const taskInput: TaskInput = {
  description: "使用龙虾灵魂锻造工具生成一个新的 AI 代理灵魂",
  workingDir: "/path/to/work",
  action: {
    type: "ecc_skill",
    target: "openclaw-persona-forge",
    content: JSON.stringify({
      mode: "gacha",
      times: 1
    })
  }
};
```

### 高级使用

#### 1. 列出所有可用的 ECC 技能

```bash
# 通过测试脚本查看
npx tsx test/ecc-skill-executor-test.ts
```

#### 2. 获取特定技能的详细信息

查看 `ecc-skills/<skill-id>/SKILL.md` 文件，了解该技能的详细用法。

#### 3. 创建自定义 ECC 技能

在 `ecc-skills` 目录下创建新的技能目录，按照 ECC 的 SKILL.md 规范定义技能：

```
ecc-skills/
└── my-custom-skill/
    ├── SKILL.md          # 技能定义
    ├── main.py          # Python 实现（可选）
    └── main.sh          # Shell 实现（可选）
```

## 架构设计

### 执行流程

```
MRX 任务 (action.type = "ecc_skill")
    ↓
ExecutorRegistry 识别
    ↓
ECCSkillExecutor.canHandle() 返回 true
    ↓
ECCSkillExecutor.execute()
    ├─ 查找 ECC 技能
    ├─ 解析技能元数据
    ├─ 调用技能脚本 (Python/Shell)
    └─ 返回执行结果
    ↓
MRX 继续处理结果
```

### 文件结构

```
openclaw-mrx/
├── core/
│   └── executor/
│       ├── executor.ts                 # 执行器接口
│       ├── executor-registry.ts        # 执行器注册表
│       ├── command-executor.ts         # 命令执行器
│       ├── file-executor.ts            # 文件执行器
│       ├── tool-executor.ts            # 工具执行器
│       ├── ecc-skill-executor.ts       # ✨ 新增：ECC 技能执行器
│       └── executor-factory.ts         # ✨ 新增：执行器工厂
├── ecc-skills/                         # ✨ 新增：ECC 技能库（200+ 技能）
│   ├── openclaw-persona-forge/
│   ├── search-first/
│   ├── verification-loop/
│   └── ...
├── test/
│   └── ecc-skill-executor-test.ts      # ✨ 新增：ECC 执行器测试
└── ECC-INTEGRATION.md                  # ✨ 新增：本文档
```

## 配置

### 环境变量

- `ECC_SKILLS_DIR`：ECC 技能目录的路径（默认为 `./ecc-skills`）

### 修改 ECCSkillExecutor 的行为

在 `core/executor/ecc-skill-executor.ts` 中可以修改：

- **超时时间**：默认 5 分钟（300000ms），可在 `executePythonScript` 和 `executeShellScript` 方法中修改
- **输出大小限制**：默认 10000 字符，可在相应方法中修改
- **错误处理策略**：参考 ECC 的降级策略实现

## 测试

### 运行 ECC 执行器测试

```bash
npx tsx test/ecc-skill-executor-test.ts
```

### 运行所有测试

```bash
npm run build
npx tsx cli/mrx-skeleton.ts test
```

## 已知限制

1. **脚本超时**：ECC 技能脚本的执行时间限制为 5 分钟。
2. **输出大小**：脚本输出被限制在 10000 字符以内。
3. **参数传递**：目前仅支持简单的命令行参数传递。
4. **错误处理**：某些 ECC 技能可能需要特定的环境配置才能正常运行。

## 故障排查

### 问题 1：找不到 ECC 技能

**症状**：执行 ECC 技能时报错 "ECC 技能不存在"

**解决方案**：
1. 检查 `ecc-skills` 目录是否存在
2. 确认技能目录名称是否正确
3. 运行 `npx tsx test/ecc-skill-executor-test.ts` 查看已加载的技能列表

### 问题 2：技能脚本执行失败

**症状**：技能执行返回错误信息

**解决方案**：
1. 检查技能目录中的 `SKILL.md` 文件，了解该技能的前置条件
2. 确保所需的依赖（如 Python、Node.js 等）已安装
3. 查看脚本的错误输出，了解具体的失败原因

### 问题 3：性能问题

**症状**：执行 ECC 技能时速度很慢

**解决方案**：
1. 检查技能脚本的复杂度
2. 考虑增加超时时间（在 `ecc-skill-executor.ts` 中修改）
3. 检查系统资源使用情况

## 贡献

欢迎为此集成项目贡献改进和新功能。请参考 `CONTRIBUTING.md` 了解贡献指南。

## 许可证

此项目遵循 MIT 许可证。详见 `LICENSE` 文件。

## 相关资源

- [MRX 原始仓库](https://github.com/zhbcher/openclaw-mrx)
- [ECC 原始仓库](https://github.com/affaan-m/ECC)
- [MRX 教程](./TUTORIAL.zh-CN.md)
- [ECC 安全指南](./ecc-skills/../../../docs/the-security-guide.md)
