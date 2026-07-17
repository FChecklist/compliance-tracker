// VERIDIAN Review Framework remediation, Wave B: tests the pure Training/LMS
// state-model functions (generateCertificateCode / isAllLessonsComplete /
// computeEnrollmentStatus) directly, matching this repo's established
// pattern of not exercising withTenantContext/a live DB from a .test.ts
// file (see hr-attendance-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { generateCertificateCode, isAllLessonsComplete, computeEnrollmentStatus } from "./training-service"

describe("generateCertificateCode", () => {
  test("always starts with CERT- and is uppercase", () => {
    const code = generateCertificateCode("enrollment-123")
    expect(code.startsWith("CERT-")).toBe(true)
    expect(code).toBe(code.toUpperCase())
  })
  test("two calls with the same seed still differ (random suffix)", () => {
    const a = generateCertificateCode("same-seed")
    const b = generateCertificateCode("same-seed")
    expect(a).not.toBe(b)
  })
})

describe("isAllLessonsComplete", () => {
  test("a course with zero lessons is never lesson-complete", () => {
    expect(isAllLessonsComplete(0, [])).toBe(false)
  })
  test("true only once every lesson has a completed progress row", () => {
    expect(isAllLessonsComplete(2, [{ status: "completed" }])).toBe(false)
    expect(isAllLessonsComplete(2, [{ status: "completed" }, { status: "completed" }])).toBe(true)
  })
  test("an in_progress row does not count as complete", () => {
    expect(isAllLessonsComplete(1, [{ status: "in_progress" }])).toBe(false)
  })
})

describe("computeEnrollmentStatus", () => {
  test("not_started with no progress rows at all", () => {
    expect(computeEnrollmentStatus(3, [])).toBe("not_started")
  })
  test("in_progress once at least one lesson has started or completed", () => {
    expect(computeEnrollmentStatus(3, [{ status: "in_progress" }])).toBe("in_progress")
    expect(computeEnrollmentStatus(3, [{ status: "completed" }])).toBe("in_progress")
  })
  test("completed only once every lesson is completed", () => {
    expect(computeEnrollmentStatus(2, [{ status: "completed" }, { status: "completed" }])).toBe("completed")
  })
})
