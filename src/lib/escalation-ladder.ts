// Formal executive escalation ladder (tree4-unified area 4's "Formal
// executive escalation ladder... as enforced code, not session-level
// working practice documented only in AGENTS.md" -- 05-eighteen-areas-
// tracker.yaml). Source: Consutitution.docx's AI Escalation Matrix
// (ai-os/audit-tree/01-consutitution.yaml lines 70-101) and the named
// COO/CEE/CSEO triad (same file, lines 634-636). Deterministic, no LLM
// call -- matches this codebase's existing preference for cheap,
// reliable gates (floor-tier-escalation.ts is the direct precedent this
// module's shape follows).
//
// Ladder order, lowest to highest AI-reachable rung:
//   1. CSEO (Chief Software Engineering Officer) -- source doc's own
//      mandate is explicitly "software engineering, implementation,
//      testing, code quality" (line 516), the exact shape of a
//      software-first execution failure (an engine not found, or an
//      engine throwing mid-calculation).
//   2. COO (Chief Operating Officer) -- Escalation Matrix Level 3:
//      "Cross-Agent Decisions, Policy Interpretation, Conflict
//      Resolution, ... Escalation Handling" -- the right rung for
//      non-software-shaped triggers (repeated guardrail failure, budget/
//      loop limits) and the fallback when a CSEO-level escalation is
//      already in flight and still needs to go further.
//   3. Super Boss -- Escalation Matrix Level 4, "final escalation leader;
//      decision-taking when lower levels fail or need advice." Terminal
//      AI rung: Level 5 (Owner, Rajat Agarwal) is a human and outside
//      this module's reach by construction -- there is no roleKey to
//      escalate to programmatically past Super Boss.
import type { RoleDefinition } from "./ai-team/roster"
import { getRole } from "./ai-team/roster"

export type EscalationReason =
  | "engine_not_found"
  | "engine_execution_failed"
  | "worker_agent_unavailable"
  | "guardrail_repeated_failure"
  | "budget_limit_hit"
  | "loop_limit_hit"
  // tree4-unified/50-completion-plan area 3 "Guardrails", D18/PLAN-20:
  // Constitution Guardrail 9's "below 90% escalation required" band
  // (confidence-banding.ts's bandConfidence()) -- a governance/policy
  // trigger, not a code defect, so it starts at COO like the other
  // non-software-first reasons below, not at CSEO.
  | "low_confidence_closure"
  // tree4-unified/50-completion-plan area 6 "Monitoring": a Dynamic Chain's
  // monitoringRules (monitoring-engine.ts's evaluateMonitoringRules()) fired
  // an "escalate"-action rule -- a governance/policy trigger (the chain's
  // own declared threshold, not a code defect), so it starts at COO like
  // low_confidence_closure above, not at CSEO.
  | "monitoring_rule_violation"

export type EscalationContext = {
  reason: EscalationReason
  /**
   * Set when this is a repeat escalation for the same failure (e.g. CSEO
   * was already tried and the underlying problem is still unresolved) --
   * the roleKey previously returned by this function for that failure.
   * Omit on the first escalation.
   */
  priorEscalationRoleKey?: string | null
}

export type EscalationRung = {
  roleKey: string
  title: string
  /** Why this rung, verbatim from the role's authority in the source Escalation Matrix -- not paraphrased, so a reviewer can trace it back. */
  authority: string
}

// Software-shaped failures start at CSEO; everything else (guardrail/
// budget/loop triggers are cross-agent policy concerns, not code defects)
// starts at COO -- Level 3's authority list names exactly these
// (Conflict Resolution, Escalation Handling, Framework Enforcement),
// while CSEO's mandate is specifically coding/implementation.
const SOFTWARE_FIRST_REASONS: ReadonlySet<EscalationReason> = new Set([
  "engine_not_found",
  "engine_execution_failed",
  "worker_agent_unavailable",
])

const LADDER: readonly EscalationRung[] = [
  { roleKey: "chief_software_engineering_officer", title: "Chief Software Engineering Officer (CSEO)", authority: "Coding, Implementation, Code generation, Bug fixes, Testing, Refactoring" },
  { roleKey: "chief_operating_officer", title: "Chief Operating Officer (COO)", authority: "Cross-Agent Decisions, Policy Interpretation, Conflict Resolution, Performance Monitoring, Priority Management, Escalation Handling, Framework Enforcement" },
  { roleKey: "super_boss", title: "Super Boss / Executive Director", authority: "Architecture, Policy, Code Approval, Strategic Decisions, Framework Changes, Agent Creation, Agent Retirement, Emergency Override, Human Communication, Rollout Responsibility" },
]

/**
 * Given an escalation trigger, returns the correct next rung of the
 * executive ladder to escalate to. Pure function: no I/O, no dispatch --
 * callers decide what "escalating" concretely means at their call site
 * (e.g. task-execution-engine.ts records it in a chat message today; a
 * future caller could actually dispatch the returned role).
 */
export function nextEscalationRung(context: EscalationContext): EscalationRung {
  if (context.priorEscalationRoleKey) {
    const currentIndex = LADDER.findIndex((rung) => rung.roleKey === context.priorEscalationRoleKey)
    // Unknown or already-terminal rung: Super Boss is the highest AI-
    // reachable rung (Level 5/Owner is human, outside this ladder).
    if (currentIndex === -1 || currentIndex >= LADDER.length - 1) return LADDER[LADDER.length - 1]
    return LADDER[currentIndex + 1]
  }
  const startIndex = SOFTWARE_FIRST_REASONS.has(context.reason) ? 0 : 1
  return LADDER[startIndex]
}

/** Resolves a rung's full roster.ts RoleDefinition, for callers that need the model/team, not just the roleKey. */
export function resolveEscalationRole(rung: EscalationRung): RoleDefinition | undefined {
  return getRole(rung.roleKey)
}
