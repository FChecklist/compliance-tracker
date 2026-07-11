/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { nextEscalationRung, resolveEscalationRole } from "./escalation-ladder"

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
