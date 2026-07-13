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
//
// U-D2.B1.S1 reconciliation note (tree4-unified/10-merged-governance-layer
// .yaml): a DIFFERENT source document ("Consutitution.docx's AI Escalation
// Matrix" above) describes a 6-level L0-L5 ladder (L0 Execution Agent ->
// L1 Reviewer -> L2 Quality Controller -> L3 COO -> L4 Super Boss -> L5
// Owner) that is NOT the same ladder this module implements -- CSEO isn't
// named in that spec at all. Both ladders are real and both are kept,
// deliberately not merged into one: this module's CSEO/COO/Super-Boss
// ladder answers "who handles a FAILURE," while the L0-L5 spec is a
// staffing/authority hierarchy. Where they overlap (COO=L3, Super Boss=L4)
// roster.ts's escalationLevel field tags the same roleKeys this module
// already resolves to. L0 (chief_execution_engine, GPT-OSS-120B) is also
// tagged. L1 (Reviewer) and L2 (Quality Controller) are realized as
// PROCESS gates, not roles -- AI_TEAM_CLOSURE_REVIEW_LEAF's peer review
// and QA_PRECOMPLETION_GATE_LEAF (guardrail-registrations.ts) -- so no
// roleKey is force-tagged onto them; see roster.ts's RoleDefinition
// comment for the full reasoning.
import type { RoleDefinition } from "./ai-team/roster"
import { getRole } from "./ai-team/roster"
import { monitorTaskState } from "./db"
import type { TenantDb } from "./db/tenant-scoped"
import { and, eq } from "drizzle-orm"

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
  // tree4-unified/50-completion-plan area 9 "Auditing", audit-cadence.ts's
  // classifyAuditCadence(): Guardrail 10's "risk level determines...
  // escalation level" for the critical tier specifically -- also a
  // governance/policy trigger (risk classification, not a code defect),
  // starts at COO for the same reason as low_confidence_closure above.
  | "critical_risk_closure"
  // Priority 5 (10-priority5-software-orchestrator-tracker.yaml): Lower AI
  // package-dispatch failure shapes. "package_execution_failed" is a real
  // Lower AI execution defect (the LLM call itself failed, or its output
  // failed the same sanity check engine dispatch already enforces via
  // assertValidDispatchOutput) -- software-shaped, starts at CSEO like
  // engine_execution_failed. "package_missing_information" is the hard
  // MISSING_INFORMATION rule (executePackageDispatch() in
  // task-execution-engine.ts): a required variable had no resolvable value
  // in the task's own input, and Lower AI is deliberately forbidden from
  // guessing one -- also a software-first defect (the package/capability
  // itself needs a better variable-extraction path, not a policy call), so
  // it starts at CSEO too, not COO.
  | "package_execution_failed"
  | "package_missing_information"

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
  "package_execution_failed",
  "package_missing_information",
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

// ─── Single-owner lock + persisted retry/timeout counter ─────────────────
// PLATFORM_STRATEGY.md 29.3 Phase 0: this module's own header (above) had
// long documented the real gap -- "no MAX_RETRY, TIMEOUT, or ownership
// concept -- callers decide what escalating concretely means." Everything
// above this point (LADDER, nextEscalationRung, resolveEscalationRole)
// stays exactly as-is and stays pure -- no I/O, no dispatch, per its own
// existing doc comment. Everything below is new, additive, and explicitly
// DB-touching where it needs to be (persisted ownership genuinely cannot
// live in a pure function across separate requests).
//
// Fail-closed shape mirrors activity-log-service.ts's recordPeerReview()
// exactly: recordPeerReview blocks `reviewedBy === userId` under reason
// 'self_review_not_allowed' ("no agent may certify its own work");
// claimEscalation() generalizes the same discriminated-union, fail-closed
// posture to "no agent may claim/escalate a task another agent already
// owns" -- a different check (task ownership, not self-certification), same
// shape: a result union the caller must branch on, never a silent no-op.

export type EscalationTaskState = {
  taskId: string
  ownerRoleKey: string
  rungIndex: number
  retryCount: number
  /** Epoch ms of the last (re-)claim -- compared against timeoutMs to decide staleness. */
  lastEscalatedAt: number
  status: "active" | "retry_exhausted"
}

export type EscalationClaimParams = {
  taskId: string
  context: EscalationContext
  /** Snapshot of monitor_agents.max_retry for the monitor driving this claim. */
  maxRetry: number
  /** Snapshot of monitor_agents.timeout_ms -- how long a claim may sit before it's stale and reclaimable. */
  timeoutMs: number
  /** Injectable for deterministic tests; defaults to Date.now(). */
  nowMs?: number
}

export type EscalationClaimResult =
  | { claimed: true; rung: EscalationRung; retryCount: number; nextState: EscalationTaskState }
  | { claimed: false; reason: "already_owned_by_other_agent"; ownerRoleKey: string; nextState: EscalationTaskState }
  | { claimed: false; reason: "retry_exhausted"; retryCount: number; maxRetry: number; nextState: EscalationTaskState }

/**
 * Pure decision function: given the current persisted state for a task
 * (null if never escalated before) and a claim attempt, decides whether the
 * claim succeeds, is rejected because a DIFFERENT agent still actively owns
 * it (single-owner lock, "no infinite retry"/"single active owner" per
 * section 29's intro), or is rejected because MAX_RETRY has been exceeded
 * ("no infinite retry"). No I/O -- unit-tested directly, same posture as
 * approval-workflow-service.ts's isSelfApproval() (this repo's established
 * pattern of testing the pure predicate rather than the withTenantContext
 * wrapper around it -- see that file's test header).
 *
 * A stale claim (now - lastEscalatedAt > timeoutMs) is treated as
 * reclaimable rather than permanently stuck -- this is TIMEOUT's whole
 * point: an owner that never resolves the escalation must not block it
 * forever, but reclaiming still consumes a retry, so a repeatedly-timing-out
 * escalation still hits MAX_RETRY and stops rather than looping forever.
 */
export function evaluateEscalationClaim(existing: EscalationTaskState | null, params: EscalationClaimParams): EscalationClaimResult {
  const rung = nextEscalationRung(params.context)
  const rungIndex = LADDER.findIndex((r) => r.roleKey === rung.roleKey)
  const nowMs = params.nowMs ?? Date.now()

  if (!existing) {
    return {
      claimed: true,
      rung,
      retryCount: 1,
      nextState: { taskId: params.taskId, ownerRoleKey: rung.roleKey, rungIndex, retryCount: 1, lastEscalatedAt: nowMs, status: "active" },
    }
  }

  if (existing.status === "retry_exhausted") {
    return { claimed: false, reason: "retry_exhausted", retryCount: existing.retryCount, maxRetry: params.maxRetry, nextState: existing }
  }

  const isStale = nowMs - existing.lastEscalatedAt > params.timeoutMs
  if (!isStale && existing.ownerRoleKey !== rung.roleKey) {
    return { claimed: false, reason: "already_owned_by_other_agent", ownerRoleKey: existing.ownerRoleKey, nextState: existing }
  }

  // Either the same owner re-escalating (a genuine retry) or a stale claim
  // being reclaimed -- both consume a retry against the same MAX_RETRY
  // budget, so a task that keeps timing out still terminates.
  const nextRetryCount = existing.retryCount + 1
  if (nextRetryCount > params.maxRetry) {
    return {
      claimed: false,
      reason: "retry_exhausted",
      retryCount: nextRetryCount,
      maxRetry: params.maxRetry,
      nextState: { ...existing, retryCount: nextRetryCount, status: "retry_exhausted" },
    }
  }
  return {
    claimed: true,
    rung,
    retryCount: nextRetryCount,
    nextState: { taskId: params.taskId, ownerRoleKey: rung.roleKey, rungIndex, retryCount: nextRetryCount, lastEscalatedAt: nowMs, status: "active" },
  }
}

function toEscalationTaskState(row: typeof monitorTaskState.$inferSelect): EscalationTaskState {
  return {
    taskId: row.taskId,
    ownerRoleKey: row.ownerRoleKey,
    rungIndex: row.rungIndex,
    retryCount: row.retryCount,
    lastEscalatedAt: row.lastEscalatedAt.getTime(),
    status: row.status === "retry_exhausted" ? "retry_exhausted" : "active",
  }
}

export type ClaimEscalationParams = {
  orgId: string
  taskId: string
  monitorName: string
  context: EscalationContext
  maxRetry: number
  timeoutMs: number
}

/**
 * DB-touching wrapper over evaluateEscalationClaim(): reads the persisted
 * monitor_task_state row (if any) for this (org, task, monitor), applies
 * the pure decision, and persists the resulting state in the same
 * transaction. Must be called with the SAME tx a caller's withTenantContext
 * already opened (e.g. src/app/api/approvals/[id]/route.ts's PATCH
 * handler), matching every other DB-touching function in this codebase's
 * tenant-scoped convention. Not unit-tested directly -- see
 * evaluateEscalationClaim()'s own doc comment for why the pure half is
 * where real test coverage lives.
 */
export async function claimEscalation(db: TenantDb, params: ClaimEscalationParams): Promise<EscalationClaimResult> {
  const existingRow = await db.query.monitorTaskState.findFirst({
    where: and(eq(monitorTaskState.orgId, params.orgId), eq(monitorTaskState.taskId, params.taskId), eq(monitorTaskState.monitorName, params.monitorName)),
  })
  const existing = existingRow ? toEscalationTaskState(existingRow) : null
  const result = evaluateEscalationClaim(existing, { taskId: params.taskId, context: params.context, maxRetry: params.maxRetry, timeoutMs: params.timeoutMs })

  if (!existingRow) {
    await db.insert(monitorTaskState).values({
      orgId: params.orgId,
      taskId: params.taskId,
      monitorName: params.monitorName,
      ownerRoleKey: result.nextState.ownerRoleKey,
      rungIndex: result.nextState.rungIndex,
      retryCount: result.nextState.retryCount,
      maxRetry: params.maxRetry,
      timeoutMs: params.timeoutMs,
      status: result.nextState.status,
      lastEscalatedAt: new Date(result.nextState.lastEscalatedAt),
    })
  } else if (result.nextState !== existing) {
    // Reference-equality skip: evaluateEscalationClaim() returns the exact
    // `existing` object back (not a copy) for both no-op rejection branches
    // (already_owned_by_other_agent, and re-rejecting an already-
    // retry_exhausted row) -- nothing changed, so no write is needed. Any
    // other outcome (claimed, or a fresh transition into retry_exhausted)
    // builds a new object and does need persisting.
    await db.update(monitorTaskState).set({
      ownerRoleKey: result.nextState.ownerRoleKey,
      rungIndex: result.nextState.rungIndex,
      retryCount: result.nextState.retryCount,
      status: result.nextState.status,
      lastEscalatedAt: new Date(result.nextState.lastEscalatedAt),
      updatedAt: new Date(),
    }).where(eq(monitorTaskState.id, existingRow.id))
  }

  return result
}
