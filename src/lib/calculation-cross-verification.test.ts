/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { calculateEmi } from "./engines/banking-engine"
import { calculateGratuity } from "./engines/payroll-engine"
import { crossVerifyEmi, crossVerifyGratuity, assertCalculationVerified, CalculationVerificationError } from "./calculation-cross-verification"

describe("crossVerifyEmi -- independent schedule-summation check", () => {
  test("verifies a real, correctly-computed interest-bearing loan", () => {
    const input = { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 }
    const result = calculateEmi(input)
    expect(crossVerifyEmi(input, result)).toEqual({ verified: true })
  })

  test("verifies a real, correctly-computed zero-interest loan", () => {
    const input = { principal: 120000, annualRatePercent: 0, tenureMonths: 12 }
    const result = calculateEmi(input)
    expect(crossVerifyEmi(input, result)).toEqual({ verified: true })
  })

  test("verifies a single-month loan", () => {
    const input = { principal: 10000, annualRatePercent: 12, tenureMonths: 1 }
    const result = calculateEmi(input)
    expect(crossVerifyEmi(input, result)).toEqual({ verified: true })
  })

  test("catches a corrupted schedule whose summed principal doesn't match the loan principal", () => {
    const input = { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 }
    const result = calculateEmi(input)
    const corrupted = { ...result, schedule: result.schedule.map((row, i) => i === 0 ? { ...row, principalPaid: row.principalPaid + 10000 } : row) }
    const verification = crossVerifyEmi(input, corrupted)
    expect(verification.verified).toBe(false)
    if (!verification.verified) expect(verification.reason).toContain("total principal paid")
  })

  test("catches a schedule with the wrong number of rows", () => {
    const input = { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 }
    const result = calculateEmi(input)
    const corrupted = { ...result, schedule: result.schedule.slice(0, 59) }
    const verification = crossVerifyEmi(input, corrupted)
    expect(verification.verified).toBe(false)
    if (!verification.verified) expect(verification.reason).toContain("Schedule has 59 rows")
  })

  test("catches a schedule that doesn't fully amortize to zero", () => {
    const input = { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 }
    const result = calculateEmi(input)
    const lastIndex = result.schedule.length - 1
    const corrupted = { ...result, schedule: result.schedule.map((row, i) => i === lastIndex ? { ...row, balance: 5000 } : row) }
    const verification = crossVerifyEmi(input, corrupted)
    expect(verification.verified).toBe(false)
    if (!verification.verified) expect(verification.reason).toContain("not zero")
  })

  test("assertCalculationVerified throws CalculationVerificationError on a failed verification", () => {
    const input = { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 }
    const result = calculateEmi(input)
    const corrupted = { ...result, schedule: result.schedule.map((row, i) => i === 0 ? { ...row, principalPaid: row.principalPaid + 10000 } : row) }
    expect(() => assertCalculationVerified(crossVerifyEmi(input, corrupted), "EMI test")).toThrow(CalculationVerificationError)
  })
})

describe("crossVerifyGratuity -- independent statutory-bound check", () => {
  test("verifies a real, uncapped gratuity calculation", () => {
    const input = { lastDrawnMonthlySalary: 60000, yearsOfService: 7.6 }
    const result = calculateGratuity(input)
    expect(crossVerifyGratuity(input, result)).toEqual({ verified: true })
  })

  test("verifies a statutorily-capped gratuity calculation without applying the ratio bound", () => {
    const input = { lastDrawnMonthlySalary: 500000, yearsOfService: 35 }
    const result = calculateGratuity(input)
    expect(result.statutoryCapApplied).toBe(true)
    expect(crossVerifyGratuity(input, result)).toEqual({ verified: true })
  })

  test("verifies the non-covered-establishment (15/30) divisor path", () => {
    const input = { lastDrawnMonthlySalary: 40000, yearsOfService: 10, isCoveredUnderAct: false }
    const result = calculateGratuity(input)
    expect(crossVerifyGratuity(input, result)).toEqual({ verified: true })
  })

  test("catches a result that exceeds one month's salary per year of service", () => {
    const input = { lastDrawnMonthlySalary: 60000, yearsOfService: 8 }
    const result = calculateGratuity(input)
    const corrupted = { ...result, gratuityAmount: 60000 * 8 * 2 } // implausibly large, as if the formula multiplied instead of divided
    const verification = crossVerifyGratuity(input, corrupted)
    expect(verification.verified).toBe(false)
    if (!verification.verified) expect(verification.reason).toContain("exceeds one month's salary")
  })

  test("catches a negative gratuity amount", () => {
    const input = { lastDrawnMonthlySalary: 60000, yearsOfService: 8 }
    const result = calculateGratuity(input)
    const corrupted = { ...result, gratuityAmount: -1000 }
    const verification = crossVerifyGratuity(input, corrupted)
    expect(verification.verified).toBe(false)
    if (!verification.verified) expect(verification.reason).toBe("Computed gratuity is negative.")
  })
})
