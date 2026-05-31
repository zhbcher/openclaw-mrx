/**
 * ECC Integration Module
 * 
 * 导出所有 ECC 集成相关的类和函数。
 */

export { ECCRuleLoader, getECCRuleLoader } from "./rule-loader.js";
export type { ECCRule, ECCAgent, AgentMatchResult } from "./rule-loader.js";

export { ECCContextEnricher } from "./context-enricher.js";
export type { EnrichedContext } from "./context-enricher.js";

export { ECCContextBuilder } from "./ecc-context-builder.js";
export type { ContextBuildResult } from "./ecc-context-builder.js";

export { ECCAgentAdapter } from "./agent-adapter.js";
export type { ECCAgentContext } from "./agent-adapter.js";

export { ECCVerifier } from "./ecc-verifier.js";
export type { ECCVerificationResult } from "./ecc-verifier.js";

export { AgentShieldGate } from "./shield-gate.js";
export type { ShieldReport, ShieldViolation } from "./shield-gate.js";
