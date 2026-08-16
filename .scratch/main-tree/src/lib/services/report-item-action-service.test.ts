/// <reference types="bun-types" />
// Owner directive 2026-07-13: tests the pure validation function --
// createReportItemAction()/listReportItemActions() themselves touch the DB
// and are deliberately left untested here, matching this repo's
// established pattern (see delegation-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { validateReportItemActionInput } from "./report-item-action-service"

describe("validateReportItemActionInput", () => {
  test("valid: accept", () => {
    expect(validateReportItemActionInput({ reportId: "r1", rowId: "status:pending", action: "accept" })).toEqual({ valid: true })
  })

  test("valid: delegate", () => {
    expect(validateReportItemActionInput({ reportId: "r1", rowId: "status:pending", action: "delegate" })).toEqual({ valid: true })
  })

  test("valid: todo", () => {
    expect(validateReportItemActionInput({ reportId: "r1", rowId: "status:pending", action: "todo" })).toEqual({ valid: true })
  })

  test("rejects an empty reportId", () => {
    const result = validateReportItemActionInput({ reportId: "  ", rowId: "row1", action: "accept" })
    expect(result.valid).toBe(false)
  })

  test("rejects an empty rowId", () => {
    const result = validateReportItemActionInput({ reportId: "r1", rowId: "  ", action: "accept" })
    expect(result.valid).toBe(false)
  })

  test("rejects an invalid action", () => {
    // @ts-expect-error deliberately invalid for the test
    const result = validateReportItemActionInput({ reportId: "r1", rowId: "row1", action: "reject" })
    expect(result.valid).toBe(false)
  })
})
