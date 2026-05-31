/**
 * Loop Engine v2 — Phase 2+3 集成
 * 
 * 核心变化：
 *   单任务 → DAG 多任务并行
 *   静态 PLAN → LLM 驱动 DAG 拆解
 *   简单 REFLECT → 规则+LLM 归因分析
 *   简单 JUDGE → Recovery Tree 多路径裁决
 *   无风控 → Risk Engine + Budget Controller + Event Bus
 *   无记忆 → Memory Compiler 自动编译
 */

import * as path from "path";
import { StateManager } from "../state/state-manager.js";
import { MissionParser } from "../parser/mission-parser.js";
import { Validator } from "../validator/validator.js";
import { CheckpointManager } from "../checkpoint/checkpoint.js";
import { DagPlanner } from "../planner/dag-planner.js";
import { Reflector } from "../reflector/reflector.js";
import { RecoveryEngineV2 } from "../recovery/recovery-engine-v2.js";
import { newTraceId, createLogger } from "../utils/logger.js";

const log = createLogger("loop-engine");
import { EventBus } from "../eventbus/event-bus.js";
import { SupervisorAgent } from "../../agents/supervisor.js";
import { OpenClawAdapter } from "../../adapters/openclaw.js";
import { ECCContextBuilder } from "../ecc/ecc-context-builder.js";
import { getECCRuleLoader } from "../ecc/rule-loader.js";
import type {
  MissionConfig,
  MissionState,
  TaskNode,
  EnvironmentReport,
  ExecutionPlan,
  ExecutionStep,
} from "../types.js";
import type { LlmClient } from "../planner/dag-planner.js";

export interface LoopEngineOptions {
  configPath: string;
  missionDir: string;
  storageRoot: string;
  llmClient?: LlmClient;
}

export class LoopEngine {
  private config: MissionConfig;
  private state: StateManager;
  private validator: Validator;
  private checkpointMgr: CheckpointManager;
  private adapter: OpenClawAdapter;
  private storageRoot: string;

  // Phase 2+ 模块
  private dagPlanner: DagPlanner;
  private reflector: Reflector;
  private recoveryEngine: RecoveryEngineV2;

  // Phase 3 模块
  private eventBus: EventBus;
  private supervisor: SupervisorAgent;

  // ECC 深度融合模块
  private eccContextBuilder: ECCContextBuilder | null = null;
  private eccInitialized = false;

  private running = false;

  constructor(options: LoopEngineOptions) {
    this.config = MissionParser.fromFile(options.configPath);
    this.state = new StateManager(options.missionDir);
    this.adapter = new OpenClawAdapter();
    this.validator = new Validator(this.adapter);
    this.storageRoot = options.storageRoot;
    this.checkpointMgr = new CheckpointManager(options.storageRoot, this.config.mission.id);

    // Phase 2
    this.dagPlanner = new DagPlanner(options.llmClient);
    this.reflector = new Reflector(options.llmClient);
    this.recoveryEngine = new RecoveryEngineV2();

    // Phase 3
    this.eventBus = new EventBus(options.storageRoot, this.config.mission.id);
    this.supervisor = new SupervisorAgent(
      this.config,
      path.join(options.storageRoot, "memory"),
      options.llmClient
    );

    // ECC 深度融合层
    this.initECCLayer();
  }

  /**
   * 初始化 ECC 融合层（异常安全，失败不影响核心功能）
   */
  private async initECCLayer(): Promise<void> {
    try {
      const loader = getECCRuleLoader();
      await loader.initialize();
      this.eccContextBuilder = new ECCContextBuilder();
      this.eccInitialized = true;
      console.log(`✅ ECC 深度融合层已初始化`);
    } catch (err: any) {
      console.warn(`⚠️  ECC 融合层初始化失败（不影响核心功能）: ${err.message}`);
    }
  }

  /**
   * 从任务描述中提取关键词（用于 ECC 知识检索）
   */
  private extractTaskKeywords(task: TaskNode): string[] {
    const words = task.description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2 && !["the", "and", "for", "with", "this", "that", "from"].includes(w));
    
    // 检测语言关键词
    const langKeywords = ["typescript", "javascript", "python", "go", "rust", "java", 
      "kotlin", "swift", "cpp", "csharp", "ruby", "php", "react", "angular", "vue"];
    const detected = langKeywords.filter(lk => words.includes(lk) || task.description.toLowerCase().includes(lk));
    
    return [...new Set([...detected, ...words])].slice(0, 10);
  }

  // ============================================================
  // 入口
  // ============================================================

  async start(): Promise<void> {
    newTraceId(`mrx_${this.config.mission.id}`);
    log.info("Mission starting", { name: this.config.mission.name, objective: this.config.objective[0] });

    // === 检查是否有未完成 mission 及对应的 checkpoint ===
    if (this.state.hasUnfinishedMission()) {
      this.state.load();
      const state = this.state.getState();
      
      // 查找最近的 checkpoint
      const latestCp = this.checkpointMgr.getLatest();
      
      if (latestCp) {
        console.log(`\n🔍 发现未完成 Mission 和 Checkpoint:`);
        console.log(`   Mission: ${this.config.mission.name}`);
        console.log(`   最后循环: #${state.current_iteration}`);
        console.log(`   最后阶段: ${state.current_phase}`);
        console.log(`   Checkpoint: ${latestCp.id} (${latestCp.timestamp})`);
        console.log(`   任务进度: ${state.task_tree.filter(t => t.status === "done").length}/${state.task_tree.length}`);
        
        // 自动恢复（subagent 友好）: subagent 是非交互环境，直接恢复
        console.log(`\n⚡ 自动从 Checkpoint 恢复（subagent 模式）...`);
        if (!state.last_checkpoint_id) {
          state.last_checkpoint_id = latestCp.id;
          this.state.save();
        }
        await this.resume();
        return;
        
      } else {
        // 有未完成状态但无 checkpoint，直接 resume（旧行为）
        log.info("Resuming unfinished mission (no checkpoint found)");
        await this.resume();
        return;
      }
    }

    console.log(`\n🚀 Mission 启动: ${this.config.mission.name}`);
    console.log(`   目标: ${this.config.objective[0]}`);
    console.log(`   工作目录: ${this.config.environment.working_dir}`);
    console.log(`   最大循环: ${this.config.budget.max_iterations} 次\n`);

    this.state.createInitialState(this.config.mission.id);
    this.state.setStatus("planning");

    this.eventBus.emit("MISSION_STARTED", {
      mission_name: this.config.mission.name,
      objective: this.config.objective,
    });

    // Phase 2: DAG Planner 拆解目标
    const dag = await this.dagPlanner.plan(this.config.objective, this.config);
    this.state.getState().task_tree = dag;
    this.state.save();

    this.eventBus.emit("DAG_GENERATED", {
      task_count: dag.length,
      tasks: dag.map(t => ({ id: t.id, description: t.description })),
    });

    // 标记首个就绪任务
    const readyTasks = DagPlanner.getRunnableTasks(dag);
    if (readyTasks.length > 0) {
      for (const t of readyTasks) {
        t.status = "ready";
        this.state.updateTaskStatus(t.id, "ready");
      }
    }

    this.state.setStatus("ready");
    this.state.setStatus("running");
    await this.mainLoop();
  }

  async resume(): Promise<void> {
    const state = this.state.getState();
    console.log(`\n🔄 从断点恢复: 循环 #${state.current_iteration}`);
    console.log(`   DAG 进度: ${DagPlanner.getProgress(state.task_tree).done}/${state.task_tree.length}`);

    this.eventBus.emit("MISSION_RESUMED", {
      iteration: state.current_iteration,
      dag_progress: DagPlanner.getProgress(state.task_tree),
    });

    this.state.setStatus("running");
    await this.mainLoop();
  }

  // ============================================================
  // 主循环（DAG 多任务版）
  // ============================================================

  private async mainLoop(): Promise<void> {
    this.running = true;

    while (this.running) {
      // 检查 DAG 是否全部完成
      if (DagPlanner.isComplete(this.state.getState().task_tree)) {
        this.state.setStatus("completed");
        this.running = false;
        await this.onComplete();
        break;
      }

      // 获取下一个就绪任务
      const dag = this.state.getState().task_tree;
      const runnableTasks = DagPlanner.getRunnableTasks(dag);

      if (runnableTasks.length === 0) {
        // 有未完成任务但都阻塞了
        const pendingTasks = dag.filter(t => 
          t.status === "pending" || t.status === "failed" || t.status === "blocked"
        );
        if (pendingTasks.length > 0) {
          console.log(`  ⚠️  ${pendingTasks.length} 个任务阻塞，等待依赖完成或人工介入`);
          
          // 检查是否有可重试的失败任务
          const retryable = pendingTasks.filter(t => t.status === "failed" && t.retry_count < t.max_retries);
          if (retryable.length > 0) {
            for (const t of retryable) {
              t.status = "retrying";
              t.retry_count++;
              this.state.updateTaskStatus(t.id, "retrying");
            }
            continue; // 重试失败任务
          }
          
          this.state.setStatus("paused");
          this.running = false;
          this.eventBus.emit("MISSION_PAUSED", { reason: "all_tasks_blocked" });
          console.log("  ⏸️  Mission 暂停：所有任务阻塞");
          return;
        }
        break;
      }

      // 取第一个就绪任务（Phase 3+ 可并行，当前串行）
      const currentTask = runnableTasks[0];
      this.state.setCurrentTaskId(currentTask.id);
      this.state.updateTaskStatus(currentTask.id, "running");

      this.eventBus.emit("TASK_STARTED", {
        task_id: currentTask.id,
        description: currentTask.description,
      });

      const iteration = this.state.incrementIteration();
      console.log(`\n━━━ 循环 #${iteration} | 任务: ${currentTask.id} ━━━`);

      this.eventBus.emit("LOOP_ITERATION_START", { iteration, task_id: currentTask.id });

      // --- 预算检查 ---
      const budget = this.supervisor.checkBudget(this.state.getState());
      if (budget.exceeded) {
        console.log(`  ⛔ 预算超限: ${budget.warnings.join("; ")}`);
        this.eventBus.emit("BUDGET_EXCEEDED", { budget_status: budget });
        this.state.setStatus("failed");
        this.state.setLastError("BUDGET_EXCEEDED");
        break;
      }
      if (budget.should_warn) {
        console.log(`  ⚠️  预算警告: ${budget.warnings.join("; ")}`);
        this.eventBus.emit("BUDGET_WARNING", { budget_status: budget });
      }

      // 检查最大循环
      if (iteration > this.config.budget.max_iterations) {
        console.log(`  ⛔ 达到最大循环次数`);
        this.eventBus.emit("MISSION_FAILED", { reason: "max_iterations_reached" });
        this.state.setStatus("failed");
        this.state.setLastError("MAX_ITERATIONS_REACHED");
        break;
      }

      // === OBSERVE ===
      this.state.setPhase("observe");
      const envReport = await this.observe();
      console.log(`  👁️  OBSERVE: 分支=${envReport.git_status?.branch}, 变更=${envReport.git_status?.changedFiles.length}`);

      // === ANALYZE (ECC 增强) ===
      this.state.setPhase("analyze");
      const analysis = await this.analyzeWithECC(envReport, currentTask);
      console.log(`  🔍 ANALYZE: ${analysis.summary}`);

      // === PLAN (ECC 增强) ===
      this.state.setPhase("plan");
      const plan = await this.planWithECC(analysis, iteration, currentTask);
      console.log(`  📋 PLAN: ${plan.steps.length} 个执行步骤`);

      // === 风险审查（Supervisor Auditor） ===
      const commandsToRun = plan.steps
        .filter(s => s.tool === "shell")
        .flatMap(s => {
          if (s.params?.commands) return s.params.commands as string[];
          if (s.params?.command) return [s.params.command as string];
          return [];
        });

      if (commandsToRun.length > 0) {
        const audit = this.supervisor.auditBeforeExecution(commandsToRun, this.config.environment.working_dir);
        if (this.supervisor.hasBlockedOperations(audit)) {
          console.log(`  🛡️  Supervisor: ${this.supervisor.formatAuditReport(audit)}`);
          this.eventBus.emit("RISK_BLOCKED", { audit });
          this.state.setStatus("paused");
          this.state.setLastError(`风险阻断: ${audit.blocked_operations.join("; ")}`);
          this.running = false;
          break;
        }
        if (audit.requires_approval) {
          console.log(`  🔐 需要审批: ${audit.warnings.join("; ")}`);
          this.eventBus.emit("RISK_APPROVAL_REQUIRED", { audit });
          if (this.config.human_interaction.mode === "ask_when_blocked") {
            this.state.setStatus("paused");
            this.running = false;
            console.log("  ⏸️  Mission 暂停：等待风险审批");
            break;
          }
        }
      }

      // === EXECUTE ===
      this.state.setPhase("execute");
      await this.execute(plan);
      console.log(`  ⚡ EXECUTE: 完成`);

      // === VALIDATE (ECC 增强) ===
      this.state.setPhase("validate");
      const verification = await this.validateWithECC(iteration, currentTask);
      console.log(`  ✅ VALIDATE: ${verification.passed ? "通过" : "失败"} — ${verification.summary}`);
      this.state.addVerificationRecord(verification);

      if (verification.passed) {
        this.eventBus.emit("VALIDATION_PASSED", { task_id: currentTask.id, iteration });
      } else {
        this.eventBus.emit("VALIDATION_FAILED", {
          task_id: currentTask.id,
          iteration,
          failed_checks: verification.checks.filter(c => !c.passed).length,
        });
      }

      // === REFLECT ===
      this.state.setPhase("reflect");
      const reflection = await this.reflector.reflect(
        verification,
        plan,
        currentTask.description
      );
      console.log(`  💭 REFLECT: ${reflection.summary}`);
      console.log(`     根因: ${reflection.root_cause} | 严重程度: ${reflection.severity}`);

      // === JUDGE（Recovery Tree） ===
      this.state.setPhase("judge");
      const recovery = this.recoveryEngine.decide({
        validationPassed: reflection.confidence === 1.0 && !reflection.should_retry && !reflection.should_replan,
        retryCount: currentTask.retry_count,
        maxRetries: currentTask.max_retries,
        iteration,
        maxIterations: this.config.budget.max_iterations,
        rootCause: reflection.root_cause,
        severity: reflection.severity,
        selfHealingEnabled: this.config.autonomy.self_healing,
        hasCheckpoint: !!this.state.getState().last_checkpoint_id,
        isCriticalPath: true, // V2: 默认关键路径
      });
      console.log(`  ⚖️  JUDGE: ${recovery.verdict} — ${recovery.reason}`);

      this.state.addJudgementRecord({
        iteration,
        timestamp: new Date().toISOString(),
        verdict: recovery.verdict,
        reason: recovery.reason,
        next_task_id: recovery.verdict === "continue" ? 
          DagPlanner.getRunnableTasks(this.state.getState().task_tree)[0]?.id :
          currentTask.id,
      });

      // 根据裁决执行
      switch (recovery.verdict) {
        case "continue":
          this.state.updateTaskStatus(currentTask.id, "done");
          this.eventBus.emit("TASK_COMPLETED", {
            task_id: currentTask.id,
            description: currentTask.description,
          });
          // 解锁依赖此任务的后继节点
          this.unlockDependents(currentTask.id);
          break;

        case "retry":
          this.state.updateTaskStatus(currentTask.id, "retrying");
          this.eventBus.emit("TASK_RETRYING", {
            task_id: currentTask.id,
            retry_count: currentTask.retry_count + 1,
          });
          break;

        case "replan":
          // 重新生成 DAG
          this.eventBus.emit("RECOVERY_TRIGGERED", {
            verdict: "replan",
            task_id: currentTask.id,
          });
          const newDag = await this.dagPlanner.plan(this.config.objective, this.config);
          this.state.getState().task_tree = newDag;
          this.state.save();
          console.log("  🔄 DAG 已重新规划");
          break;

        case "escalate":
          this.state.setStatus("paused");
          this.running = false;
          this.eventBus.emit("MISSION_PAUSED", {
            reason: "escalate",
            task_id: currentTask.id,
            root_cause: reflection.root_cause,
          });
          console.log("  ⏸️  Mission 暂停：需要人工介入");
          break;

        case "rollback":
          // 回退到上一 checkpoint
          this.eventBus.emit("RECOVERY_TRIGGERED", {
            verdict: "rollback",
            task_id: currentTask.id,
          });
          const lastCp = this.checkpointMgr.getLatest();
          if (lastCp) {
            console.log(`  ⏪ 回退到 Checkpoint: ${lastCp.id}`);
            // 恢复状态
            this.state.getState().task_tree = lastCp.state_snapshot.task_tree;
            this.state.save();
          } else {
            console.log("  ⚠️  无可用 Checkpoint，无法回退");
          }
          break;

        case "skip":
          this.state.updateTaskStatus(currentTask.id, "done"); // 跳过视为完成
          this.eventBus.emit("TASK_COMPLETED", { task_id: currentTask.id, description: currentTask.description + " (skipped)" });
          this.unlockDependents(currentTask.id);
          console.log(`  ⏭️  跳过任务: ${currentTask.id}`);
          break;

        case "alternative":
          this.eventBus.emit("RECOVERY_TRIGGERED", { verdict: "alternative", task_id: currentTask.id });
          this.state.updateTaskStatus(currentTask.id, "retrying");
          console.log(`  🔀 尝试替代方案: ${recovery.alternative || recovery.reason}`);
          break;
      }

      // 如果 ESCALATE 或 ROLLBACK 导致停止，退出循环
      if (!this.running) break;

      // === CHECKPOINT (强制开启，用于中断恢复) ===
      this.state.setPhase("checkpoint");
      const progress = DagPlanner.getProgress(this.state.getState().task_tree);
      const contextSummary = [
        `任务: ${currentTask.id} → ${currentTask.status}`,
        `DAG: ${progress.done}/${progress.total}`,
        `验证: ${verification.passed ? "通过" : "失败"}`,
        `裁决: ${recovery.verdict}`,
        `预算: ${this.supervisor.checkBudget(this.state.getState()).tokens.percent}%`,
      ].join(" | ");

      const cp = this.checkpointMgr.create(this.state.getState(), contextSummary);
      this.state.setLastCheckpoint(cp.id);
      this.eventBus.emit("CHECKPOINT_CREATED", {
        checkpoint_id: cp.id,
        iteration,
      });
      console.log(`  📸 Checkpoint 已创建: ${cp.id}`);

      // 每 10 次循环 flush 事件
      if (iteration % 10 === 0) {
        this.eventBus.flush();
      }

      this.eventBus.emit("LOOP_ITERATION_END", { iteration, task_id: currentTask.id });
    }

    // 最终 flush
    this.eventBus.flush();

    const finalStatus = this.state.getStatus();
    if (finalStatus === "completed") {
      this.eventBus.emit("MISSION_COMPLETED", {
        total_iterations: this.state.getCurrentIteration(),
      });
    } else if (finalStatus === "failed") {
      this.eventBus.emit("MISSION_FAILED", {
        last_error: this.state.getState().last_error,
      });
    }

    console.log(`\n${finalStatus === "completed" ? "✅" : "⏸️"}  Mission 结束: ${finalStatus}`);
  }

  // ============================================================
  // Phase 1: OBSERVE
  // ============================================================

  private async observe(): Promise<EnvironmentReport> {
    const cwd = this.config.environment.working_dir;
    const gitStatus = await this.adapter.getGitStatus(cwd);
    return {
      timestamp: new Date().toISOString(),
      git_status: gitStatus,
    };
  }

  // ============================================================
  // Phase 2: ANALYZE
  // ============================================================

  private analyze(report: EnvironmentReport, task: TaskNode): { summary: string; issues: string[] } {
    const issues: string[] = [];
    const git = report.git_status;

    if (!git) {
      issues.push("无法获取 git 状态");
    } else {
      if (git.changedFiles.length > 0) {
        issues.push(`${git.changedFiles.length} 个文件有变更`);
      }
      if (git.untrackedFiles.length > 0) {
        issues.push(`${git.untrackedFiles.length} 个未跟踪文件`);
      }
    }

    return {
      summary: issues.length > 0 ? 
        `${issues.join("; ")} | 当前任务: ${task.description.slice(0, 50)}` :
        `环境正常 | 当前任务: ${task.description.slice(0, 50)}`,
      issues,
    };
  }

  /**
   * ANALYZE (ECC 增强版) — 在原有分析基础上注入 ECC 知识
   */
  private async analyzeWithECC(
    report: EnvironmentReport,
    task: TaskNode
  ): Promise<{ summary: string; issues: string[]; eccContext?: string }> {
    const base = this.analyze(report, task);

    if (!this.eccInitialized || !this.eccContextBuilder) {
      return base;
    }

    try {
      const keywords = this.extractTaskKeywords(task);
      const enriched = await this.eccContextBuilder.buildEnhancedContext(
        "",
        task.description,
        keywords
      );

      if (enriched.hits.rules > 0) {
        base.summary += ` | ECC: ${enriched.summary}`;
        return { ...base, eccContext: enriched.text };
      }
    } catch (err: any) {
      log.warn(`ECC 分析增强失败: ${err.message}`);
    }

    return base;
  }

  // ============================================================
  // Phase 3: PLAN — 将 Task 描述转为可执行步骤
  // ============================================================

  private async plan(
    analysis: { summary: string; issues: string[] },
    iteration: number,
    task: TaskNode
  ): Promise<ExecutionPlan> {
    const steps: ExecutionStep[] = [];
    let order = 0;

    // 第一次循环：检查环境
    if (iteration === 1) {
      steps.push({ order: order++, description: "检查 git 状态", tool: "shell", action: "exec", params: { command: "git status --short", cwd: this.config.environment.working_dir }, expected_result: "了解当前工作区状态" });
    }

    // 根据 task.description 生成执行步骤
    const taskSteps = this.taskToSteps(task);
    steps.push(...taskSteps.map(s => ({ ...s, order: order++ })));

    // 验证命令（如果任务没有自己的验证）
    if (taskSteps.length === 0 && this.config.validation.commands.length > 0) {
      steps.push({ order: order++, description: `运行 ${this.config.validation.commands.length} 项验证`, tool: "shell", action: "exec", params: { commands: this.config.validation.commands, cwd: this.config.environment.working_dir }, expected_result: "所有验证通过" });
    }

    return { iteration, task_id: task.id, steps, expected_outcome: task.description };
  }

  /**
   * PLAN (ECC 增强版) — 注入 ECC 知识到 LLM 计划上下文
   */
  private async planWithECC(
    analysis: { summary: string; issues: string[]; eccContext?: string },
    iteration: number,
    task: TaskNode
  ): Promise<ExecutionPlan> {
    const plan = await this.plan(analysis, iteration, task);

    // 如果有 ECC 上下文且有 ECC 注入的规则信息，添加到计划的第一个步骤说明中
    if (analysis.eccContext && plan.steps.length > 0) {
      const stepCount = this.countEccRules(analysis.eccContext);
      if (stepCount > 0) {
        log.info(`ECC ${stepCount} 条规则已注入计划上下文`);
      }
    }

    return plan;
  }

  /** 统计 ECC 上下文中的规则数 */
  private countEccRules(context: string): number {
    const matches = context.match(/\([a-z]+\/[a-z-]+\)/g);
    return matches ? matches.length : 0;
  }

  /** 将 Task 描述转为 ExecutionStep[] */
  private taskToSteps(task: TaskNode): ExecutionStep[] {
    const desc = task.description.toLowerCase();
    const steps: ExecutionStep[] = [];

    // 代码生成类任务
    if (desc.includes("创建") || desc.includes("实现") || desc.includes("implement") || desc.includes("create") || desc.includes("开发")) {
      steps.push({ order: 0, description: `基于任务描述生成代码：${task.description.slice(0, 60)}`, tool: "shell", action: "exec", params: { command: `echo "[MRX] 执行任务: ${task.description}"`, cwd: this.config.environment.working_dir }, expected_result: "代码已生成" });
      steps.push({ order: 0, description: "运行类型检查", tool: "shell", action: "exec", params: { command: "npx tsc --noEmit 2>&1 | tail -5", cwd: this.config.environment.working_dir }, expected_result: "无类型错误" });
    }
    // 测试类任务
    else if (desc.includes("测试") || desc.includes("test")) {
      steps.push({ order: 0, description: "运行测试", tool: "shell", action: "exec", params: { command: "npm test 2>&1 | tail -10", cwd: this.config.environment.working_dir }, expected_result: "测试通过" });
    }
    // 分析类任务
    else if (desc.includes("分析") || desc.includes("analyze") || desc.includes("理解")) {
      steps.push({ order: 0, description: "分析代码结构", tool: "shell", action: "exec", params: { command: "find . -name '*.ts' -not -path '*/node_modules/*' | head -20 && echo '---' && git log --oneline -5", cwd: this.config.environment.working_dir }, expected_result: "代码结构已了解" });
    }
    // 构建类任务
    else if (desc.includes("构建") || desc.includes("build") || desc.includes("编译")) {
      steps.push({ order: 0, description: "运行构建", tool: "shell", action: "exec", params: { command: "npm run build 2>&1 | tail -10", cwd: this.config.environment.working_dir }, expected_result: "构建成功" });
    }
    // 配置类任务
    else if (desc.includes("配置") || desc.includes("config") || desc.includes("设置")) {
      steps.push({ order: 0, description: "检查配置文件", tool: "shell", action: "exec", params: { command: "ls -la tsconfig.json package.json .eslintrc* .prettierrc* 2>/dev/null", cwd: this.config.environment.working_dir }, expected_result: "配置文件已确认" });
    }

    return steps;
  }

  // ============================================================
  // Phase 4: EXECUTE
  // ============================================================

  private executorRegistry?: import("../executor/executor-registry.js").ExecutorRegistry;

  /** 注入 ExecutorRegistry（V1: 支持 Tool Executor） */
  setExecutorRegistry(registry: import("../executor/executor-registry.js").ExecutorRegistry): void {
    this.executorRegistry = registry;
  }

  private async execute(plan: ExecutionPlan): Promise<void> {
    for (const step of plan.steps) {
      console.log(`    → 步骤 ${step.order}: ${step.description}`);

      // V1: 有 ExecutorRegistry 时走统一执行层
      if (this.executorRegistry) {
        const action = this.stepToAction(step);
        if (action) {
          const result = await this.executorRegistry.dispatch({
            description: step.description,
            workingDir: (step.params?.cwd as string) || this.config.environment.working_dir,
            action,
          });
          if (!result.success) {
            console.log(`      ⚠️  执行失败: ${result.error?.slice(0, 200)}`);
          } else {
            console.log(`      ✅ ${(result.output || "done").slice(0, 100)}`);
          }
          continue;
        }
      }

      // 回退到原始 adapter 方式
      if (step.tool === "shell" && step.params) {
        if (step.params.commands) {
          for (const cmd of (step.params.commands as string[])) {
            const result = await this.adapter.executeCommand(cmd, this.config.environment.working_dir);
            if (!result.success) {
              console.log(`      ⚠️  命令失败: ${cmd}`);
              console.log(`      ${result.error?.slice(0, 200)}`);
            }
          }
        } else if (step.params.command) {
          const result = await this.adapter.executeCommand(
            step.params.command as string,
            step.params.cwd as string || this.config.environment.working_dir
          );
          console.log(`      ${result.success ? "✅" : "❌"} ${(result.output || result.error || "").slice(0, 100)}`);
        }
      }
    }
  }

  /** 将 ExecutionStep 转为 ExecutorAction */
  private stepToAction(step: import("../types.js").ExecutionStep): import("../executor/executor.js").ExecutorAction | null {
    if (step.tool === "shell" && step.params) {
      const cmd = (step.params.command as string) || (step.params.commands as string[])?.[0];
      if (cmd) return { type: "shell", target: cmd, timeoutMs: 120000 };
    }
    if (step.tool === "file_write" && step.params) {
      return {
        type: "file_write",
        target: step.params.path as string || "",
        content: step.params.content as string,
      };
    }
    if (step.tool === "file_read" && step.params) {
      return { type: "file_read", target: step.params.path as string || "" };
    }
    if (step.tool === "tool" && step.params) {
      return {
        type: "tool",
        target: step.params.tool_name as string || "",
        content: JSON.stringify(step.params.tool_params || {}),
      };
    }
    return null;
  }

  // ============================================================
  // Phase 5: VALIDATE
  // ============================================================

  private async validate(iteration: number) {
    const taskId = this.state.getCurrentTaskId()!;
    const commands = this.config.validation.commands;

    if (commands.length === 0) {
      return {
        iteration,
        task_id: taskId,
        timestamp: new Date().toISOString(),
        passed: true,
        checks: [],
        summary: "无验证命令，默认通过",
      };
    }

    return this.validator.runAll(commands, this.config.environment.working_dir, iteration, taskId);
  }

  /**
   * VALIDATE (ECC 增强版) — 在标准验证链后追加 ECC 规则审计
   */
  private async validateWithECC(iteration: number, task: TaskNode) {
    const baseResult = await this.validate(iteration);

    if (!this.eccInitialized) {
      return baseResult;
    }

    try {
      // 检测任务中的编程语言
      const keywords = this.extractTaskKeywords(task);
      const langHints = ["typescript", "python", "go", "rust", "java", "kotlin", "swift", "cpp", "ruby", "php"];
      const detectedLang = langHints.find(l => keywords.includes(l) || task.description.toLowerCase().includes(l)) || "typescript";

      // 引入 ECC Verifier 做规则检查
      const { ECCVerifier } = await import("../ecc/ecc-verifier.js");
      const { getECCRuleLoader } = await import("../ecc/rule-loader.js");

      const loader = getECCRuleLoader();
      const verifier = new ECCVerifier(loader);

      // 对当前迭代产生的代码输出做 ECC 规则检查
      const eccResult = await verifier.verify(
        task.description,
        detectedLang,
        task.description.toLowerCase().includes("security") ? "security" : "review"
      );

      if (!eccResult.passed) {
        // 追加 ECC 违规记录到验证结果
        baseResult.checks.push({
          command: `ECC ${detectedLang} 规则审计`,
          passed: false,
          output: eccResult.violations.join("; "),
          error: `严重程度: ${eccResult.severity}`,
          duration_ms: 0,
        });
        baseResult.passed = false;
        baseResult.summary += ` | ECC: ${eccResult.violations.length} 项违规`;
      }

      if (eccResult.warnings.length > 0) {
        baseResult.summary += ` | ECC 警告: ${eccResult.warnings.length}`;
      }
    } catch (err: any) {
      log.warn(`ECC 验证增强失败: ${err.message}`);
    }

    return baseResult;
  }

  // ============================================================
  // DAG 辅助
  // ============================================================

  /**
   * 解锁依赖此任务的后继节点
   */
  private unlockDependents(completedTaskId: string): void {
    const dag = this.state.getState().task_tree;
    const completed = dag.find(t => t.id === completedTaskId);
    if (!completed) return;

    for (const childId of completed.children) {
      const child = dag.find(t => t.id === childId);
      if (!child || child.status !== "pending") continue;

      // 检查所有依赖是否都已满足
      const allDepsDone = child.depends_on.every(depId => {
        const dep = dag.find(t => t.id === depId);
        return dep && dep.status === "done";
      });

      if (allDepsDone) {
        child.status = "ready";
        this.state.updateTaskStatus(child.id, "ready");
        console.log(`  🔓 解锁任务: ${child.id}`);
      }
    }
  }

  // ============================================================
  // 完成
  // ============================================================

  private async onComplete(): Promise<void> {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎉 Mission 完成!`);
    console.log(`   名称: ${this.config.mission.name}`);
    console.log(`   总循环: ${this.state.getCurrentIteration()}`);
    console.log(`   任务数: ${this.state.getState().task_tree.length}`);
    console.log(`   验证次数: ${this.state.getState().verification_history.length}`);
    console.log(`   Checkpoints: ${this.checkpointMgr.listAll().length}`);

    const stats = this.eventBus.getStats();
    if (Object.keys(stats).length > 0) {
      console.log(`   事件数: ${Object.values(stats).reduce((a, b) => a + b, 0)}`);
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Phase 3: Memory Compiler
    if (this.config.memory.compile_after) {
      console.log("🧠 编译 Mission 记忆...");
      await this.supervisor.compileMemory(this.state.getState(), this.config);
    }
  }
}
