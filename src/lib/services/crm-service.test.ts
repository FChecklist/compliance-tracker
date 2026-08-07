// VERIDIAN Review Framework gap-closure: Sales Pipeline (2026-08-07).
// Tests the pure predicate isValidStageTransition() only -- every other
// crm-service.ts export touches the DB via withTenantContext, deliberately
// untested here per this repo's established pattern (see
// crm-accounts-service.test.ts's own header note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isValidStageTransition } from "./crm-service"

const STAGES = [
  { stageKey: "prospecting", isWon: false, isLost: false },
  { stageKey: "proposal", isWon: false, isLost: false },
  { stageKey: "negotiation", isWon: false, isLost: false },
  { stageKey: "won", isWon: true, isLost: false },
  { stageKey: "lost", isWon: false, isLost: true },
]
const MEMBER_RANK = 2
const MANAGER_RANK = 3

describe("isValidStageTransition", () => {
  test("allows moving between two non-terminal stages, forward", () => {
    expect(isValidStageTransition("prospecting", "negotiation", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows moving between two non-terminal stages, backward -- a deal cooling off is a real event", () => {
    expect(isValidStageTransition("negotiation", "proposal", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows a no-op (same stage)", () => {
    expect(isValidStageTransition("proposal", "proposal", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows any member to close a deal into won", () => {
    expect(isValidStageTransition("negotiation", "won", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("allows any member to close a deal into lost", () => {
    expect(isValidStageTransition("proposal", "lost", STAGES, MEMBER_RANK)).toEqual({ valid: true })
  })

  test("rejects a member reopening a won deal back into an active stage", () => {
    const result = isValidStageTransition("won", "negotiation", STAGES, MEMBER_RANK)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("manager approval")
  })

  test("rejects a member reopening a lost deal", () => {
    expect(isValidStageTransition("lost", "prospecting", STAGES, MEMBER_RANK).valid).toBe(false)
  })

  test("allows a manager to reopen a closed deal", () => {
    expect(isValidStageTransition("won", "negotiation", STAGES, MANAGER_RANK)).toEqual({ valid: true })
  })

  test("rejects an unknown target stage", () => {
    const result = isValidStageTransition("prospecting", "not-a-real-stage", STAGES, MANAGER_RANK)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Unknown pipeline stage")
  })

  test("falls back to hardcoded won/lost strings when stages config is empty (defensive)", () => {
    expect(isValidStageTransition("won", "prospecting", [{ stageKey: "prospecting", isWon: false, isLost: false }], MEMBER_RANK).valid).toBe(false)
  })
})
