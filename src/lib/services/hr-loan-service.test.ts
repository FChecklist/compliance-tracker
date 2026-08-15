// Phase 0 HR gap-closure (2026-07-27): tests the pure schedule/due-date
// helpers directly, matching this repo's established pattern of not
// exercising withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeLoanInstallmentSchedule, computeInstallmentDueDates, ServiceError } from "./hr-loan-service"

describe("computeLoanInstallmentSchedule", () => {
  test("splits evenly when principal divides cleanly", () => {
    expect(computeLoanInstallmentSchedule(12000, 12)).toEqual(new Array(12).fill(1000))
  })

  test("folds rounding remainder into the last installment -- sum always exactly equals principal", () => {
    const schedule = computeLoanInstallmentSchedule(10000, 3)
    const sum = schedule.reduce((s, a) => s + a, 0)
    expect(sum).toBeCloseTo(10000, 2)
    expect(schedule[0]).toBe(3333.33)
    expect(schedule[1]).toBe(3333.33)
    expect(schedule[2]).toBe(3333.34)
  })

  test("a single installment is the full principal", () => {
    expect(computeLoanInstallmentSchedule(5000, 1)).toEqual([5000])
  })

  test("rejects fewer than 1 installment", () => {
    expect(() => computeLoanInstallmentSchedule(5000, 0)).toThrow(ServiceError)
  })
})

describe("computeInstallmentDueDates", () => {
  test("starts the month after approval", () => {
    expect(computeInstallmentDueDates(7, 2026, 3)).toEqual([
      { month: 8, year: 2026 },
      { month: 9, year: 2026 },
      { month: 10, year: 2026 },
    ])
  })

  test("rolls over into the next year past December", () => {
    expect(computeInstallmentDueDates(11, 2026, 4)).toEqual([
      { month: 12, year: 2026 },
      { month: 1, year: 2027 },
      { month: 2, year: 2027 },
      { month: 3, year: 2027 },
    ])
  })
})
