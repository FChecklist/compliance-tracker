// V2-17 (HR performance/error-handling + payroll rate audit, 2026-07-26):
// tests validateEmployeeProfileInput() directly, the pure validation core
// upsertEmployeeProfile() delegates to -- matches this codebase's
// established pattern of not exercising withTenantContext/a live DB from a
// .test.ts file (see hr-attendance-service.test.ts's own note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateEmployeeProfileInput, ServiceError } from "./hr-service"

describe("validateEmployeeProfileInput", () => {
  test("accepts an empty input (all fields optional on update)", () => {
    expect(() => validateEmployeeProfileInput({})).not.toThrow()
  })

  test("accepts every valid employmentType", () => {
    for (const t of ["full_time", "part_time", "contract", "intern"]) {
      expect(() => validateEmployeeProfileInput({ employmentType: t })).not.toThrow()
    }
  })
  test("rejects an invalid employmentType (e.g. a typo)", () => {
    expect(() => validateEmployeeProfileInput({ employmentType: "fulltime" })).toThrow(ServiceError)
  })

  test("accepts every valid employmentStatus", () => {
    for (const s of ["active", "on_leave", "terminated", "resigned"] as const) {
      expect(() => validateEmployeeProfileInput({ employmentStatus: s })).not.toThrow()
    }
  })
  test("rejects an invalid employmentStatus", () => {
    // @ts-expect-error -- deliberately passing a value outside the enum to test the runtime guard
    expect(() => validateEmployeeProfileInput({ employmentStatus: "bogus" })).toThrow(ServiceError)
  })

  test("rejects a malformed dateOfJoining", () => {
    expect(() => validateEmployeeProfileInput({ dateOfJoining: "not-a-date" })).toThrow(ServiceError)
    expect(() => validateEmployeeProfileInput({ dateOfJoining: "2026-02-30" })).toThrow(ServiceError)
  })
  test("accepts a future dateOfJoining (onboarding ahead of start date)", () => {
    expect(() => validateEmployeeProfileInput({ dateOfJoining: "2099-01-01" })).not.toThrow()
  })

  test("rejects a malformed dateOfBirth", () => {
    expect(() => validateEmployeeProfileInput({ dateOfBirth: "not-a-date" })).toThrow(ServiceError)
  })
  test("rejects a future dateOfBirth", () => {
    expect(() => validateEmployeeProfileInput({ dateOfBirth: "2099-01-01" })).toThrow(ServiceError)
  })
  test("accepts a valid past dateOfBirth", () => {
    expect(() => validateEmployeeProfileInput({ dateOfBirth: "1990-05-15" })).not.toThrow()
  })
})
