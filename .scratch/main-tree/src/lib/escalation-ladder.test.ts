/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { nextEscalationRung, resolveEscalationRole, evaluateEscalationClaim, type EscalationTaskState } from "./escalation-ladder"

describe("nextEscalationRung", () => {
  test("a software-first failure (engine not found) starts at CSEO", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found" })
    expect(rung.roleKey).toBe("chief_software_engineering_officer")
  })

  test("a software-first failure (engine execution failed) starts at CSEO", () => {
    const rung = nextEscalationRung({ reason: "engine_execution_failed" })
    expect(rung.roleKey).toBe("chief_software_engineering_officer")
  })

  test("a worker-agent-unavailable failure starts at CSEO", () => {
    const rung = nextEscalationRung({ reason: "worker_agent_unavailable" })
    expect(rung.roleKey).toBe("chief_software_engineering_officer")
  })

  test("a non-software trigger (repeated guardrail failure) starts at COO, not CSEO", () => {
    const rung = nextEscalationRung({ reason: "guardrail_repeated_failure" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("a budget-limit trigger starts at COO", () => {
    const rung = nextEscalationRung({ reason: "budget_limit_hit" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("a loop-limit trigger starts at COO", () => {
    const rung = nextEscalationRung({ reason: "loop_limit_hit" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("a low-confidence-closure trigger (D18/PLAN-20, below-90% band) starts at COO, not CSEO", () => {
    const rung = nextEscalationRung({ reason: "low_confidence_closure" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("a monitoring-rule-violation trigger (area 6 chain enforcement) starts at COO, not CSEO", () => {
    const rung = nextEscalationRung({ reason: "monitoring_rule_violation" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("a critical-risk-closure trigger (area 9, Guardrail 10) starts at COO, not CSEO", () => {
    const rung = nextEscalationRung({ reason: "critical_risk_closure" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("escalating past CSEO goes to COO", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found", priorEscalationRoleKey: "chief_software_engineering_officer" })
    expect(rung.roleKey).toBe("chief_operating_officer")
  })

  test("escalating past COO goes to Super Boss", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found", priorEscalationRoleKey: "chief_operating_officer" })
    expect(rung.roleKey).toBe("super_boss")
  })

  test("Super Boss is terminal -- escalating past it stays at Super Boss (Owner is human, outside this ladder)", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found", priorEscalationRoleKey: "super_boss" })
    expect(rung.roleKey).toBe("super_boss")
  })

  test("an unrecognized prior rung falls back to the top of the ladder rather than throwing", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found", priorEscalationRoleKey: "not_a_real_role" })
    expect(rung.roleKey).toBe("super_boss")
  })
})

describe("resolveEscalationRole", () => {
  test("CSEO resolves to a real roster.ts role", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found" })
    const role = resolveEscalationRole(rung)
    expect(role).toBeDefined()
    expect(role?.roleKey).toBe("chief_software_engineering_officer")
    expect(role?.team).toBe("EXECUTIVE_LADDER")
  })

  test("COO resolves to a real roster.ts role on DeepSeek V4 Pro", () => {
    const rung = nextEscalationRung({ reason: "guardrail_repeated_failure" })
    const role = resolveEscalationRole(rung)
    expect(role?.model).toBe("deepseek/deepseek-v4-pro")
  })

  test("Super Boss resolves to the Human/interactive roster role, not an API-dispatched one", () => {
    const rung = nextEscalationRung({ reason: "engine_not_found", priorEscalationRoleKey: "chief_operating_officer" })
    const role = resolveEscalationRole(rung)
    expect(role?.isHuman).toBe(true)
  })
})

// PLATFORM_STRATEGY.md 29.3 Phase 0: single-owner lock + persisted
// retry/timeout counter. Pure-function tests only (no DB) -- matches this
// repo's established pattern (see approval-workflow-service.test.ts's
// header) of testing the pure predicate directly rather than the
// withTenantContext wrapper (claimEscalation()) around it.
describe("evaluateEscalationClaim -- single-owner lock", () => {
  const baseParams = { taskId: "task_1", context: { reason: "monitoring_rule_violation" as const }, maxRetry: 3, timeoutMs: 60_000 }

  test("first claim on a never-escalated task succeeds and creates state at the resolved rung", () => {
    const result = evaluateEscalationClaim(null, baseParams)
    expect(result.claimed).toBe(true)
    if (result.claimed) {
      expect(result.rung.roleKey).toBe("chief_operating_officer")
      expect(result.retryCount).toBe(1)
      expect(result.nextState.status).toBe("active")
    }
  })

  test("a second claim for the SAME task, while still owned and not stale, by a DIFFERENT resolved rung is rejected fail-closed", () => {
    const owned: EscalationTaskState = { taskId: "task_1", ownerRoleKey: "chief_software_engineering_officer", rungIndex: 0, retryCount: 1, lastEscalatedAt: Date.now(), status: "active" }
    // This context resolves to COO (rung 1), but the task is owned by CSEO (rung 0) -- a different agent already owns it.
    const result = evaluateEscalationClaim(owned, { ...baseParams, nowMs: Date.now() })
    expect(result.claimed).toBe(false)
    if (!result.claimed && result.reason === "already_owned_by_other_agent") {
      expect(result.ownerRoleKey).toBe("chief_software_engineering_officer")
    } else {
      throw new Error("expected already_owned_by_other_agent")
    }
  })

  test("re-claiming a task already owned by the SAME resolved rung succeeds as a retry and increments retryCount", () => {
    const owned: EscalationTaskState = { taskId: "task_1", ownerRoleKey: "chief_operating_officer", rungIndex: 1, retryCount: 1, lastEscalatedAt: Date.now(), status: "active" }
    const result = evaluateEscalationClaim(owned, { ...baseParams, nowMs: Date.now() })
    expect(result.claimed).toBe(true)
    if (result.claimed) expect(result.retryCount).toBe(2)
  })

  test("a stale claim (past timeoutMs) is reclaimable even by a different resolved rung, but still consumes a retry", () => {
    const staleOwner: EscalationTaskState = { taskId: "task_1", ownerRoleKey: "chief_software_engineering_officer", rungIndex: 0, retryCount: 1, lastEscalatedAt: Date.now() - 120_000, status: "active" }
    const result = evaluateEscalationClaim(staleOwner, { ...baseParams, timeoutMs: 60_000, nowMs: Date.now() })
    expect(result.claimed).toBe(true)
    if (result.claimed) {
      expect(result.rung.roleKey).toBe("chief_operating_officer")
      expect(result.retryCount).toBe(2)
    }
  })

  test("retry counter increments across repeated claims and eventually hits MAX_RETRY, rejecting further claims", () => {
    let state: EscalationTaskState | null = null
    const params = { ...baseParams, maxRetry: 3 }
    // 1st claim: creates state, retryCount 1.
    let result = evaluateEscalationClaim(state, params)
    expect(result.claimed).toBe(true)
    state = result.nextState
    // 2nd claim (same owner, retry): retryCount 2.
    result = evaluateEscalationClaim(state, params)
    expect(result.claimed).toBe(true)
    expect(result.claimed && result.retryCount).toBe(2)
    state = result.nextState
    // 3rd claim: retryCount 3, still within maxRetry.
    result = evaluateEscalationClaim(state, params)
    expect(result.claimed).toBe(true)
    expect(result.claimed && result.retryCount).toBe(3)
    state = result.nextState
    // 4th claim: retryCount would be 4 > maxRetry 3 -- rejected, no infinite retry.
    result = evaluateEscalationClaim(state, params)
    expect(result.claimed).toBe(false)
    if (!result.claimed && result.reason === "retry_exhausted") {
      expect(result.retryCount).toBe(4)
      expect(result.maxRetry).toBe(3)
      expect(result.nextState.status).toBe("retry_exhausted")
    } else {
      throw new Error("expected retry_exhausted")
    }
    state = result.nextState
    // Once retry_exhausted, ALL further claims are rejected -- even from the
    // resolved-owner rung, even if it would otherwise look reclaimable.
    result = evaluateEscalationClaim(state, params)
    expect(result.claimed).toBe(false)
    if (!result.claimed) expect(result.reason).toBe("retry_exhausted")
  })

  test("escalating past CSEO to COO resolves a different rung than the original claim, exercising the lock across a real ladder transition", () => {
    const cseoOwned: EscalationTaskState = { taskId: "task_2", ownerRoleKey: "chief_software_engineering_officer", rungIndex: 0, retryCount: 1, lastEscalatedAt: Date.now(), status: "active" }
    const escalatedContext = { reason: "engine_not_found" as const, priorEscalationRoleKey: "chief_software_engineering_officer" }
    const result = evaluateEscalationClaim(cseoOwned, { taskId: "task_2", context: escalatedContext, maxRetry: 3, timeoutMs: 60_000, nowMs: Date.now() + 120_000 })
    // Stale (120s > default timeout in this test) AND a different rung (COO) -- reclaimable.
    expect(result.claimed).toBe(true)
    if (result.claimed) expect(result.rung.roleKey).toBe("chief_operating_officer")
  })
})
