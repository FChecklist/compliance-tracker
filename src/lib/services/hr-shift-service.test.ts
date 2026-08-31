// Phase 0 HR gap-closure (2026-07-27): tests the pure roster-resolution
// helper directly, matching this repo's established pattern of not
// exercising withTenantContext/a live DB from a .test.ts file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { resolveShiftForDate } from "./hr-shift-service"

describe("resolveShiftForDate", () => {
  test("returns null when no assignment covers the date", () => {
    expect(resolveShiftForDate([], "2026-08-01")).toBeNull()
  })

  test("matches a closed date range inclusive of both endpoints", () => {
    const assignments = [{ shiftTypeId: "shift-night", startDate: "2026-08-01", endDate: "2026-08-31" }]
    expect(resolveShiftForDate(assignments, "2026-08-01")).toBe("shift-night")
    expect(resolveShiftForDate(assignments, "2026-08-31")).toBe("shift-night")
    expect(resolveShiftForDate(assignments, "2026-09-01")).toBeNull()
  })

  test("an open-ended assignment (endDate null) matches any date on/after startDate", () => {
    const assignments = [{ shiftTypeId: "shift-morning", startDate: "2026-01-01", endDate: null }]
    expect(resolveShiftForDate(assignments, "2030-01-01")).toBe("shift-morning")
    expect(resolveShiftForDate(assignments, "2025-12-31")).toBeNull()
  })

  test("when assignments overlap, the first in the passed-in order wins (caller sorts by createdAt desc)", () => {
    const assignments = [
      { shiftTypeId: "shift-newer", startDate: "2026-08-01", endDate: "2026-08-31" },
      { shiftTypeId: "shift-older", startDate: "2026-08-01", endDate: "2026-08-31" },
    ]
    expect(resolveShiftForDate(assignments, "2026-08-15")).toBe("shift-newer")
  })
})
