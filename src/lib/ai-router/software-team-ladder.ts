// AIROUTER-01 Phase 2 (Owner directive 2026-07-19): Software Team L0-L5
// execution ladder -- real orchestration on top of the Mother Router
// (mother-router.ts) and ai-os/AI_ORCHESTRA_HIERARCHY.md's Table 1
// (Software Development). This module does NOT invent a new dispatch
// mechanism: L0 maps to this codebase's existing deterministic
// software-first path (task-execution-engine.ts / CI); L1-L4 map to the
// existing /api/ai/team/dispatch -> classifyTask -> runRole pipeline,
// gated exactly as today by task-tightening.ts's ComplexityTier +
// model-tier-eligibility.ts's checkTierEligibility(); L5 IS the Mother
// Router (resolveModel()) plus Super Boss (human, AGENTS.md). This module
// is the one place that names, as data, the fixed per-level contract the
// Owner's "Universal Tightened Instruction Template" requires -- so every
// dispatch at every level carries the same structured fields instead of
// each call site re-deriving them ad hoc.
//
// Every "model" reference below is DESCRIPTIVE ONLY (today's real
// assignment, for documentation) -- the actual model used for any given
// dispatch is always resolved live through resolveModel()/
// checkTierEligibility()/roster-overrides.ts, never hardcoded here as an
// enforcement value. See AI_ORCHESTRA_HIERARCHY.md's own "model-agnostic"
// principle -- this file follows the same discipline.

import type { ComplexityTier } from "../task-tightening"

export type SoftwareTeamLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5"

/**
 * The Owner's 4-category Software Development Task Routing Matrix (Part C)
 * -- a DIFFERENT, finer axis than task-tightening.ts's 3-value
 * ComplexityTier (mechanical/integrative/judgment). Every category still
 * resolves THROUGH a ComplexityTier (see COMPLEXITY_TIER_FOR_CATEGORY
 * below) so model-tier-eligibility.ts's guardrail is never bypassed --
 * this is an additional routing signal layered on top of the tier gate,
 * not a replacement for it.
 */
export type CapabilityCategory =
  | "single_file_mechanical"
  | "multi_file_integrative"
  | "architecture_design_analysis"
  | "planning_governance_oversight"

export const COMPLEXITY_TIER_FOR_CATEGORY: Record<CapabilityCategory, ComplexityTier> = {
  single_file_mechanical: "mechanical",
  multi_file_integrative: "integrative",
  architecture_design_analysis: "integrative",
  planning_governance_oversight: "judgment",
}

export type LevelContract = {
  level: SoftwareTeamLevel
  role: string
  /** Descriptive only -- see this file's own header. */
  modelDescription: string
  primaryObjective: string
  authority: string
  notAllowed: string
  /** null for L0 (no AI, deterministic only) and L5 (Mother Router itself has no dispatched tier -- it IS the router). */
  complexityTier: ComplexityTier | null
  capabilityCategory: CapabilityCategory | null
  /** 0 = automatic/no dispatch-level retry loop (L0's own deterministic retry, L5's continuous reallocation is not a bounded "retry"). */
  retryPolicy: string
  maxAutomaticRetries: number
  escalationRules: string
  documentationRequirements: string
  evidenceRequired: string
  handoverRequirements: string
}

// The Owner's own "Universal Tightened Instruction Template," applied
// verbatim as the base escalation/documentation/evidence/handover language
// for every AI-backed level (L1-L4); L0 (no AI) and L5 (full authority,
// human-in-the-loop Super Boss) get their own distinct language below.
const TEMPLATE_BASE =
  "All instructions shall be narrow, tightly structured, deterministic, with clearly defined Input, Preconditions, Process, Output, Validation, Success Criteria, Failure Criteria, Retry Policy, Escalation Rules, Documentation Requirements, Evidence Required, and Handover Requirements. The AI agent shall not make assumptions, shall not skip steps, shall not invent information, shall not silently fail, and shall immediately escalate if any mandatory input is missing or confidence is below the required threshold."

export const SOFTWARE_TEAM_LADDER: Record<SoftwareTeamLevel, LevelContract> = {
  L0: {
    level: "L0",
    role: "Software Engine",
    modelDescription: "No AI",
    primaryObjective: "Deterministic compile/build/CI-CD/test/migration/automation.",
    authority: "None.",
    notAllowed: "Reasoning.",
    complexityTier: null,
    capabilityCategory: null,
    retryPolicy: "Automatic (per underlying tool's own retry, e.g. CI re-run) -- no AI-level retry applies.",
    maxAutomaticRetries: 0,
    escalationRules: "Escalates to L1 (Code Worker) only on an unsupported case the deterministic pipeline itself cannot handle -- logged, never silently dropped.",
    documentationRequirements: "CI/build/test logs are the documentation -- no separate narrative required.",
    evidenceRequired: "The tool's own exit code + log output.",
    handoverRequirements: "None -- fully automatic, nothing to hand over.",
  },
  L1: {
    level: "L1",
    role: "Code Worker",
    modelDescription: "GPT-OSS-20B (mechanical tier, resolved via Mother Router -- not hardcoded)",
    primaryObjective: "Execute one narrow deliverable (one API/SQL/UI/test) per dispatch.",
    authority: "Execute only.",
    notAllowed: "Architecture decisions.",
    complexityTier: "mechanical",
    capabilityCategory: "single_file_mechanical",
    retryPolicy: "1 automatic retry on failure/low-confidence before escalating.",
    maxAutomaticRetries: 1,
    escalationRules: "Escalate immediately if any mandatory input is missing, or if overall_confidence is below 95%.",
    documentationRequirements: TEMPLATE_BASE,
    evidenceRequired: "The Execution Report for this task_id (see instruction-contract.ts), plus the actual diff/output produced.",
    handoverRequirements: "Execution Report handed back to the dispatching L4/L5 (or its Supervisor); task_register row updated with status.",
  },
  L2: {
    level: "L2",
    role: "Sequential Worker",
    modelDescription: "GPT-OSS-20B (mechanical tier, resolved via Mother Router -- not hardcoded)",
    primaryObjective: "Execute an approved multi-step workflow (API+SQL+tests+docs) sequentially, validating every step; rollback current step on failure.",
    authority: "Execute only.",
    notAllowed: "Design decisions.",
    complexityTier: "mechanical",
    capabilityCategory: "single_file_mechanical",
    retryPolicy: "1 automatic retry per failed step before escalating (rolls back only the current step, not the whole workflow).",
    maxAutomaticRetries: 1,
    escalationRules: "Escalate immediately on a failed step that survives its 1 retry, missing input, or overall_confidence below 95%.",
    documentationRequirements: TEMPLATE_BASE,
    evidenceRequired: "One Execution Report step per workflow step, accumulated under the same task_id.",
    handoverRequirements: "Execution Report (multi-step) handed back to the dispatching L4/L5; task_register row updated with status.",
  },
  L3: {
    level: "L3",
    role: "Feature Worker",
    modelDescription: "GPT-OSS-20B / optionally GPT-OSS-120B, subject to model-tier-eligibility.ts's INTEGRATIVE_ELIGIBLE gate (resolved via Mother Router -- not hardcoded)",
    primaryObjective: "Implement an approved feature across multiple files (incl. refactor/bug-fix), with compile+test validation.",
    authority: "Implementation only.",
    notAllowed: "Architecture changes.",
    complexityTier: "integrative",
    capabilityCategory: "multi_file_integrative",
    retryPolicy: "1 automatic retry on compile/test failure or low-confidence before escalating.",
    maxAutomaticRetries: 1,
    escalationRules: "Escalate immediately on a dependency issue, missing input, or overall_confidence below 95%.",
    documentationRequirements: TEMPLATE_BASE,
    evidenceRequired: "Compile/test output plus the Execution Report for this task_id.",
    handoverRequirements: "Execution Report handed back to the dispatching L4 (Coding Supervisor); mandatory audit per model-tier-eligibility.ts's requiresMandatoryAudit() (no model at this tier is judgment-eligible).",
  },
  L4: {
    level: "L4",
    role: "Coding Supervisor",
    modelDescription: "GLM-5.2 / Claude Code CLI (judgment tier, resolved via Mother Router -- not hardcoded)",
    primaryObjective: "Architecture, code review, debugging, optimization; analyze -> plan -> review.",
    authority: "Technical decisions.",
    notAllowed: "Company decisions.",
    complexityTier: "judgment",
    // Owner's Part C matrix separately buckets "architecture/design/
    // analysis" under DeepSeek V4 Pro (integrative tier) -- a genuinely
    // LOWER-stakes analytical task category than L4's own full "Coding
    // Supervisor" authority (architecture DECISIONS, code review, final
    // technical approval), which Part A's own table and the already-merged
    // ai-os/AI_ORCHESTRA_HIERARCHY.md both assign to GLM-5.2/Claude Code
    // CLI (judgment tier). L4 therefore maps to "planning_governance_
    // oversight" here (Part C's own bucket 4 explicitly lists "PR review,"
    // "final technical approval," and "engineering governance" -- all real
    // L4 activities) rather than "architecture_design_analysis" -- that
    // category remains a valid, dispatchable CapabilityCategory in its own
    // right (an integrative-tier analysis task, e.g. "analyze this
    // codebase's caching strategy"), just not THIS level's default. Forcing
    // L4 onto the DeepSeek-tier category would silently downgrade the
    // judgment-tier guardrail this level requires -- see mother-router.test.ts
    // for the regression proof this mapping must never contradict
    // complexityTier="judgment".
    capabilityCategory: "planning_governance_oversight",
    retryPolicy: "As needed -- a judgment-tier role re-plans rather than blindly retrying the same approach.",
    maxAutomaticRetries: 0,
    escalationRules: "Escalate on a business conflict beyond technical scope (Company-level decision required).",
    documentationRequirements: TEMPLATE_BASE,
    evidenceRequired: "Architecture/review artifact plus the Execution Report for this task_id.",
    handoverRequirements: "Execution Report + reviewed artifact handed back to L5 (Mother Router / Super Boss).",
  },
  L5: {
    level: "L5",
    role: "Mother Router / Super Boss",
    modelDescription: "GLM-5.2 / Claude Code CLI + human (Claude Desktop, interactive) -- resolveModel() IS this level, not a dispatched worker",
    primaryObjective: "Decompose -> assign -> monitor: task allocation, continuous KPI review, reallocate on issues.",
    authority: "Full authority.",
    notAllowed: "Routine coding itself.",
    complexityTier: null,
    capabilityCategory: "planning_governance_oversight",
    retryPolicy: "Continuous -- KPI review and reallocation never stop, not a bounded retry count.",
    maxAutomaticRetries: 0,
    escalationRules: "None -- full authority, the top of the ladder (mirrors AGENTS.md's authority hierarchy: only the repository owner outranks Super Boss).",
    documentationRequirements: "Every routing decision is logged to platform.ai_routing_audit_log (mother-router.ts); every task contract/report is logged to platform.task_register.",
    evidenceRequired: "ai_routing_audit_log + task_register rows for the full task tree this level assigned.",
    handoverRequirements: "None owed upward -- L5 reports only to the repository owner (AGENTS.md authority_hierarchy).",
  },
}

export function getLevelContract(level: SoftwareTeamLevel): LevelContract {
  return SOFTWARE_TEAM_LADDER[level]
}

/** Every level below L4 that is dispatched through /api/ai/team/dispatch is expected to declare this tier -- used to fail closed on a level/tier mismatch before any model is resolved or called. */
export function complexityTierForLevel(level: SoftwareTeamLevel): ComplexityTier | null {
  return SOFTWARE_TEAM_LADDER[level].complexityTier
}

export function capabilityCategoryForLevel(level: SoftwareTeamLevel): CapabilityCategory | null {
  return SOFTWARE_TEAM_LADDER[level].capabilityCategory
}

export type LevelDispatchValidation =
  | { valid: true }
  | { valid: false; reason: string; guidance: string }

/**
 * Fails closed on an inconsistent (level, complexityTier) pairing --
 * mirrors checkTierEligibility()'s own "never silently grant a mismatch"
 * posture. L0 and L5 are never dispatched through the worker-level tier
 * gate at all (L0 has no AI; L5 IS the router) -- passing either here is
 * always rejected, the caller must not attempt to run them through this
 * path.
 */
export function validateLevelDispatch(level: SoftwareTeamLevel, complexityTier: ComplexityTier): LevelDispatchValidation {
  const contract = SOFTWARE_TEAM_LADDER[level]
  if (contract.complexityTier === null) {
    return {
      valid: false,
      reason: `Level "${level}" (${contract.role}) is not a worker-level dispatch -- it has no complexityTier of its own.`,
      guidance: level === "L0"
        ? "L0 (Software Engine) is deterministic/no-AI -- route this through the existing software-first execution path (task-execution-engine.ts), not /api/ai/team/dispatch."
        : "L5 (Mother Router / Super Boss) IS the router/orchestrator -- it assigns work to L1-L4, it is not itself a dispatch target.",
    }
  }
  if (contract.complexityTier !== complexityTier) {
    return {
      valid: false,
      reason: `Level "${level}" (${contract.role}) requires complexityTier="${contract.complexityTier}", but "${complexityTier}" was supplied.`,
      guidance: `Set complexityTier to "${contract.complexityTier}" for a ${level} dispatch, or choose the level whose complexityTier actually matches "${complexityTier}".`,
    }
  }
  return { valid: true }
}
