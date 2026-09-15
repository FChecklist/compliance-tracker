/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeExposureTotal } from "./dpdp-exposure-service"

describe("computeExposureTotal", () => {
  test("sums direct counts and multiplies vendor headcount", () => {
    const total = computeExposureTotal({
      employees: 10, customers: 100, applicants: 5, cctvMonthly: 20, other: 0,
      vendorCount: 2, vendorStaffEach: 4, advisorCount: 1,
    })
    // 10 + 100 + 5 + 20 + 0 + (2*4) + 1
    expect(total).toBe(144)
  })

  test("never goes negative even with bad input", () => {
    expect(computeExposureTotal({ employees: -50, customers: 0, applicants: 0, cctvMonthly: 0, other: 0, vendorCount: 0, vendorStaffEach: 0, advisorCount: 0 })).toBe(0)
  })

  test("zero everything is zero", () => {
    expect(computeExposureTotal({ employees: 0, customers: 0, applicants: 0, cctvMonthly: 0, other: 0, vendorCount: 0, vendorStaffEach: 0, advisorCount: 0 })).toBe(0)
  })
})
