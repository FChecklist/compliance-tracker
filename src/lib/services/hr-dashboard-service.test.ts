// V2-17 (HR performance/error-handling + payroll rate audit, 2026-07-26):
// tests the pure computeAttendanceRate() helper directly, matching this
// repo's established pattern of not exercising withTenantContext/a live DB
// from a .test.ts file (see hr-attendance-service.test.ts's own note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeAttendanceRate } from "./hr-dashboard-service"

describe("computeAttendanceRate", () => {
  test("returns null for a zero headcount, not a misleading 0%", () => {
    expect(computeAttendanceRate(0, 0)).toBeNull()
  })
  test("returns null for a negative headcount (defensive, should never occur)", () => {
    expect(computeAttendanceRate(-1, 0)).toBeNull()
  })
  test("computes a rounded percentage to one decimal place", () => {
    expect(computeAttendanceRate(3, 1)).toBeCloseTo(33.3)
  })
  test("100% when everyone is marked", () => {
    expect(computeAttendanceRate(10, 10)).toBe(100)
  })
  test("0% is distinct from null -- headcount > 0 but nobody marked yet", () => {
    expect(computeAttendanceRate(5, 0)).toBe(0)
  })
})
