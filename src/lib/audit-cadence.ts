// tree4-unified/50-completion-plan area 9 "Auditing", remaining_work item 1:
// formalizes ai-os/audit-tree/02-audit-organization.yaml's "Audit Cadence
// Table -- 7 levels" (lines 264-330) as a real classification function,
// replacing the informal, unnamed gating VERIDIAN_AUDIT_ORGANIZATION.md
// already documented as [ENFORCED]/[PARTIALLY ENFORCED]/[POLICY ONLY] per
// level: dispatch/route.ts's own requiresAudit computation was already
// this codebase's de-facto L1 gate (its own comment says so) but never
// named L1 in code, and closureReviewCheck's escalation gate read
// confidenceBand only -- despite Guardrail 10 ("risk level determines...
// escalation level, audit depth") -- riskLevel was persisted on every
// activity_log row and never read back at closure.
//
// Scope, stated honestly rather than oversold: only L1 and L4 are
// classified PER TASK here. The source document's own words describe
// L2/L3/L5/L6/L7 as periodic, ORG-WIDE cadences ("every 3 hours", "once
// per day", "weekly", "monthly") that scan all activity, not something
// one task's risk/confidence can individually trigger -- inventing
// per-task logic for those five would misrepresent what the source spec
// actually says. All 7 levels are named below (AUDIT_LEVEL_DEFINITIONS)
// so the full mapping is documented, but classifyAuditCadence() only
// returns L1/L4, the two levels a single task's characteristics can
// actually determine. Scheduling L2/L3/L5/L6/L7 as real cron loops against
// activity_log is separately tracked (VERIDIAN_AUDIT_ORGANIZATION.md
// already named this exact follow-up: "needs cron wiring + the Universal
// Task Lifecycle's query surface") -- not attempted in this pass.
//
// Deterministic, no LLM call -- matches every other gate in this codebase.
import type { RiskLevel } from "./risk-classification"
import type { ConfidenceBand } from "./confidence-banding"

export type AuditLevel = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7"

export type AuditLevelDefinition = {
  level: AuditLevel
  name: string
  cadence: string
  purpose: string
  /** Whether one task's own characteristics can trigger this level, vs. it being a periodic org-wide scan that isn't about any single task. */
  perTaskTriggered: boolean
}

// Source: ai-os/audit-tree/02-audit-organization.yaml lines 264-330. L6/L7's
// cadence strings carry the source's own documented table-vs-prose conflict
// forward rather than silently picking one (see that file's own note at
// line 273) -- L5/L6/L7 all say "once per day at 11:59 IST" in the cadence
// table but "weekly"/"monthly" in the per-level prose.
export const AUDIT_LEVEL_DEFINITIONS: readonly AuditLevelDefinition[] = [
  { level: "L1", name: "Real-Time Audit", cadence: "every task/event with <95% confidence and/or a code or process change", purpose: "verify correctness before completion", perTaskTriggered: true },
  { level: "L2", name: "Continuous Monitoring", cadence: "every 3 hours (table) / \"as and when needed\" (prose)", purpose: "detect failures, hallucinations, loops, performance issues", perTaskTriggered: false },
  { level: "L3", name: "Batch Audit", cadence: "every 3 hours (table) / 30-60 minutes (prose, \"Rolling Health Audit\")", purpose: "identify trends and repeated issues across the whole organization", perTaskTriggered: false },
  { level: "L4", name: "Executive Audit Review", cadence: "every 3 hours", purpose: "Claude reviews organizational health, open critical issues, and escalations", perTaskTriggered: true },
  { level: "L5", name: "Daily Governance Review", cadence: "once per day at 11:59 IST", purpose: "deep operational analysis and improvement planning", perTaskTriggered: false },
  { level: "L6", name: "Weekly Strategic Review", cadence: "once per day at 11:59 IST (table) / weekly (prose) -- documented source conflict, see 02-audit-organization.yaml", purpose: "architecture, KPIs, recurring issues", perTaskTriggered: false },
  { level: "L7", name: "Monthly Organizational Audit", cadence: "once per day at 11:59 IST (table) / monthly (prose) -- documented source conflict, see 02-audit-organization.yaml", purpose: "long-term improvements, restructuring, metrics (\"your Board Meeting\")", perTaskTriggered: false },
]

const LEVEL_ORDER: readonly AuditLevel[] = ["L1", "L2", "L3", "L4", "L5", "L6", "L7"]

export type AuditCadenceContext = {
  riskLevel?: RiskLevel | null
  confidenceBand?: ConfidenceBand | null
}

export type AuditCadenceRouting = {
  /** Levels this specific task's characteristics trigger -- always a subset of {L1, L4}, the only two per-task-triggered levels (see module header). */
  levels: AuditLevel[]
  /** L1 -- this task cannot be marked complete without an independent review. */
  requiresRealTimeAudit: boolean
  /** L4 -- this task's risk is high enough it must surface at the next Executive Audit Review, not just wait for whichever periodic cadence would otherwise pick it up. */
  requiresExecutiveEscalation: boolean
  /** Human-readable reason(s) -- never empty when either flag above is true. */
  reasons: string[]
}

/**
 * Classifies which per-task audit levels apply to a dispatch/task, given its
 * already-computed risk level (Guardrail 10, risk-classification.ts) and
 * confidence band (Guardrail 9, confidence-banding.ts). Pure function --
 * callers decide what enforcing the result concretely means (see
 * guardrail-registrations.ts's closureReviewCheck for the real wiring).
 */
export function classifyAuditCadence(context: AuditCadenceContext): AuditCadenceRouting {
  const levels = new Set<AuditLevel>()
  const reasons: string[] = []
  let requiresRealTimeAudit = false
  let requiresExecutiveEscalation = false

  // L1 -- Constitution: "every task/event/activity with <95% confidence".
  // auto_proceed is this codebase's own >=98% band (Guardrail 9's own,
  // stricter threshold) -- any other band means confidence wasn't high
  // enough to skip audit, so L1 applies.
  if (context.confidenceBand && context.confidenceBand !== "auto_proceed") {
    requiresRealTimeAudit = true
    levels.add("L1")
    reasons.push(`confidence band '${context.confidenceBand}' is below the auto-proceed threshold`)
  }

  // L1 + L4 -- Guardrail 10: "Risk level determines... escalation level,
  // audit depth". Critical risk always needs real-time audit AND executive
  // visibility, regardless of how confident the output sounded -- a
  // perfectly-worded critical-blast-radius action is still critical.
  if (context.riskLevel === "critical") {
    requiresRealTimeAudit = true
    requiresExecutiveEscalation = true
    levels.add("L1")
    levels.add("L4")
    reasons.push("critical risk level requires real-time audit and executive escalation regardless of confidence")
  } else if (context.riskLevel === "high") {
    requiresExecutiveEscalation = true
    levels.add("L4")
    reasons.push("high risk level surfaces at the next Executive Audit Review")
  }

  return {
    levels: LEVEL_ORDER.filter((l) => levels.has(l)),
    requiresRealTimeAudit,
    requiresExecutiveEscalation,
    reasons,
  }
}
