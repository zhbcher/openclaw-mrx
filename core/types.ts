/**
 * MRX Core Types — Phase 1
 * 
 * 所有模块的数据契约定义在这里。
 * 原则：先定义类型，再写实现。类型即文档。
 */

// ============================================================
// Mission DSL 解析后的内部结构
// ============================================================

export interface MissionConfig {
  version: number;
  mission: {
    id: string;
    name: string;
    description: string;
    priority: "low" | "medium" | "high" | "critical";
  };
  objective: string[];
  context: {
    repo: string;
    branch?: string;
  };
  constraints: string[];
  environment: {
    working_dir: string;
    shell?: string;
    node_version?: string;
  };
  validation: {
    commands: string[];
    e2e?: string[];
    custom?: Array<{
      script: string;
      description: string;
    }>;
  };
  success_conditions: {
    type: "all_of" | "any_of";
    conditions: string[];
  };
  budget: {
    max_tokens: number;
    max_duration_hours: number;
    max_cost_usd: number;
    max_iterations: number;
    max_failures_per_task: number;
    warning_threshold: number;
  };
  checkpoint: {
    enabled: boolean;
    strategy: "phase" | "interval" | "manual";
    interval_minutes?: number;
  };
  memory: {
    enabled: boolean;
    persist: boolean;
    compile_after: boolean;
  };
  risk_policy: {
    require_approval: string[];
    block: string[];
  };
  human_interaction: {
    mode: "silent" | "notify" | "ask_when_blocked" | "always_ask";
    notification: string[];
  };
  autonomy: {
    retry_enabled: boolean;
    self_healing: boolean;
    auto_continue: boolean;
  };
}

// ============================================================
// 运行状态（state.yaml 的结构）
// ============================================================

export type MissionStatus =
  | "created"
  | "planning"
  | "ready"
  | "running"
  | "paused"
  | "failed"
  | "completed"
  | "archived";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "done"
  | "failed"
  | "retrying"
  | "blocked";

export interface TaskNode {
  id: string;
  description: string;
  depends_on: string[];
  children: string[];
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  result?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface MissionState {
  goal_id: string;
  status: MissionStatus;
  mission_config_path: string;
  
  current_phase: LoopPhase;
  current_iteration: number;
  current_task_id?: string;
  
  task_tree: TaskNode[];
  
  verification_history: VerificationRecord[];
  judgement_history: JudgementRecord[];
  
  budget_consumed: {
    tokens: number;
    duration_minutes: number;
    cost_usd: number;
  };
  
  last_checkpoint_id?: string;
  last_error?: string;
  
  created_at: string;
  updated_at: string;
}

// ============================================================
// 循环阶段
// ============================================================

export type LoopPhase =
  | "observe"
  | "analyze"
  | "plan"
  | "execute"
  | "validate"
  | "reflect"
  | "judge"
  | "checkpoint";

// ============================================================
// 验证与裁决
// ============================================================

export interface VerificationRecord {
  iteration: number;
  task_id: string;
  timestamp: string;
  passed: boolean;
  checks: Array<{
    command: string;
    passed: boolean;
    output?: string;
    error?: string;
    duration_ms: number;
  }>;
  summary: string;
}

export type JudgementVerdict =
  | "continue"
  | "retry"
  | "replan"
  | "rollback"
  | "escalate"
  | "complete";

export interface JudgementRecord {
  iteration: number;
  timestamp: string;
  verdict: JudgementVerdict;
  reason: string;
  next_task_id?: string;
}

// ============================================================
// Checkpoint
// ============================================================

export interface Checkpoint {
  id: string;
  mission_id: string;
  iteration: number;
  timestamp: string;
  phase: LoopPhase;
  state_snapshot: MissionState;
  context_summary: string;
}

// ============================================================
// 环境感知（OBSERVE 阶段输出）
// ============================================================

export interface EnvironmentReport {
  timestamp: string;
  repo_structure?: {
    files_count: number;
    dirs_count: number;
  };
  git_status?: {
    branch: string;
    changedFiles: string[];
    untrackedFiles: string[];
    ahead: number;
    behind: number;
  };
  build_status?: {
    last_build: "passed" | "failed" | "unknown";
    errors?: string[];
  };
  test_status?: {
    total: number;
    passed: number;
    failed: number;
    failures?: string[];
  };
  errors?: string[];
  warnings?: string[];
}

// ============================================================
// 执行计划（PLAN 阶段输出）
// ============================================================

export interface ExecutionPlan {
  iteration: number;
  task_id: string;
  steps: ExecutionStep[];
  expected_outcome: string;
}

export interface ExecutionStep {
  order: number;
  description: string;
  tool: string;           // 工具名
  action: string;         // 操作
  params?: Record<string, unknown>;
  expected_result?: string;
}

// ============================================================
// 事件（为 Event Bus 预留，Phase 2+ 启用）
// ============================================================

export type EventKind =
  | "CHECKPOINT_CREATED"
  | "MISSION_STARTED"
  | "MISSION_PAUSED"
  | "MISSION_RESUMED"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED"
  | "MISSION_ARCHIVED"
  | "DAG_GENERATED"
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_RETRYING"
  | "TASK_BLOCKED"
  | "LOOP_ITERATION_START"
  | "LOOP_ITERATION_END"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "RECOVERY_TRIGGERED"
  | "RECOVERY_SUCCESS"
  | "RECOVERY_EXHAUSTED"
  | "BUDGET_WARNING"
  | "BUDGET_EXCEEDED"
  | "RISK_APPROVAL_REQUIRED"
  | "RISK_APPROVAL_GRANTED"
  | "RISK_BLOCKED";

export interface MRXEvent {
  id: string;
  kind: EventKind;
  mission_id: string;
  timestamp: string;
  iteration?: number;
  task_id?: string;
  phase?: LoopPhase;
  data?: Record<string, unknown>;
}

// ============================================================
// 工具接口（适配器模式）
// ============================================================

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
}

export interface AgentAdapter {
  name: string;
  executeCommand(command: string, cwd: string): Promise<ToolResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<ToolResult>;
  fileExists(path: string): Promise<boolean>;
  // Phase 2+ 扩展更多工具
}
