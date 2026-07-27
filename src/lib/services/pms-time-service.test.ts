// Tests the pure resolvePmsBillableRatePure() directly -- matches this
// repo's established pattern of not touching withTenantContext/a live DB
// from a .test.ts file (see erp-payment-entries-service.test.ts's header).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { resolvePmsBillableRatePure } from "./pms-time-service"

describe("resolvePmsBillableRatePure -- 2-tier rate precedence (per-user > org default)", () => {
  test("returns null when no rates exist at all", () => {
    expect(resolvePmsBillableRatePure([], "user_1", "2026-07-27")).toBeNull()
  })

  test("returns the org default rate when no per-user rate exists", () => {
    const rates = [{ userId: null, hourlyRate: "50", validFrom: "2026-01-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(50)
  })

  test("prefers a per-user rate over the org default", () => {
    const rates = [
      { userId: null, hourlyRate: "50", validFrom: "2026-01-01" },
      { userId: "user_1", hourlyRate: "90", validFrom: "2026-01-01" },
    ]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(90)
  })

  test("ignores rates not yet valid as of the given date", () => {
    const rates = [{ userId: "user_1", hourlyRate: "90", validFrom: "2026-08-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBeNull()
  })

  test("picks the most recent validFrom among applicable per-user rates", () => {
    const rates = [
      { userId: "user_1", hourlyRate: "80", validFrom: "2026-01-01" },
      { userId: "user_1", hourlyRate: "95", validFrom: "2026-06-01" },
      { userId: "user_1", hourlyRate: "150", validFrom: "2026-09-01" }, // not yet valid
    ]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(95)
  })

  test("does not leak one user's rate onto another user", () => {
    const rates = [{ userId: "user_2", hourlyRate: "999", validFrom: "2026-01-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBeNull()
  })
})
