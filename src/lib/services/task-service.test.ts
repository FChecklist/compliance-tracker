/// <reference types="bun-types" />
// D8/D5.B4.S2 (tree4-unified 50-completion-plan, areas 1+2): tests
// validateChainDepth() directly -- the pure predicate createTask() delegates
// to for the "minimum 2-level chain selection gate" -- rather than
// exercising createTask()/POST /api/tasks end-to-end, matching this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (see handover-protocol.test.ts's own note on this).
import { describe, expect, test } from "bun:test"
import { validateChainDepth } from "./task-service"

describe("validateChainDepth -- D8/D5.B4.S2 minimum 2-level chain gate", () => {
  test("passes when chainPathKeys is entirely absent (free-text/API task creation)", () => {
    expect(validateChainDepth(undefined)).toEqual({ valid: true })
  })

  test("rejects an empty chainPathKeys array", () => {
    const result = validateChainDepth([])
    expect(result.valid).toBe(false)
  })

  test("rejects a single-level (bare top-level pill) selection", () => {
    const result = validateChainDepth(["compliance_item"])
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("at least 2 levels")
  })

  test("passes a real 2-level category + sub-option selection", () => {
    expect(validateChainDepth(["compliance_item", "mark_completed"])).toEqual({ valid: true })
  })

  test("passes a 3+ level selection", () => {
    expect(validateChainDepth(["gst_reconciliation", "gst_reconcile", "period_2026_06"])).toEqual({ valid: true })
  })
})
