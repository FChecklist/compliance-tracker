// V2-17 (HR performance/error-handling + payroll rate audit, 2026-07-26):
// tests validateEmployeeProfileInput() directly, the pure validation core
// upsertEmployeeProfile() delegates to -- matches this codebase's
// established pattern of not exercising withTenantContext/a live DB from a
// .test.ts file (see hr-attendance-service.test.ts's own note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateEmployeeProfileInput, filterOrgUsersByQuery, ORG_USER_PICKER_LIMIT, ServiceError } from "./hr-service"

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

// R67 D-19: the pure type-ahead filter behind /api/v1/projexa/users, which
// replaced PROJEXA's "paste a known VERIDIAN user ID" input. Same
// no-live-DB convention as the suite above -- listEmployees() supplies the
// rows, this decides which of them the picker shows.
describe("filterOrgUsersByQuery", () => {
  const USERS = [
    { id: "u3", name: "Arjun Mehta", email: "arjun.mehta@skyline.example", role: "pm" },
    { id: "u1", name: "Priya Nair", email: "priya@skyline.example", role: "site_engineer" },
    { id: "u2", name: null, email: "accounts@skyline.example", role: "member" },
  ]

  test("an empty query returns everyone, because the picker opens before a keystroke", () => {
    expect(filterOrgUsersByQuery(USERS, "").map((u) => u.id)).toEqual(["u2", "u3", "u1"])
    expect(filterOrgUsersByQuery(USERS, null).length).toBe(3)
    expect(filterOrgUsersByQuery(USERS).length).toBe(3)
  })

  test("matches on name, case-insensitively, from three letters in", () => {
    expect(filterOrgUsersByQuery(USERS, "arj").map((u) => u.id)).toEqual(["u3"])
    expect(filterOrgUsersByQuery(USERS, "MEHTA").map((u) => u.id)).toEqual(["u3"])
  })

  test("matches on email too, so a name nobody spells right is still findable", () => {
    expect(filterOrgUsersByQuery(USERS, "accounts@").map((u) => u.id)).toEqual(["u2"])
  })

  test("a user with no name is ordered by their email rather than crashing on null", () => {
    expect(filterOrgUsersByQuery(USERS).map((u) => u.name ?? u.email)).toEqual([
      "accounts@skyline.example",
      "Arjun Mehta",
      "Priya Nair",
    ])
  })

  test("a query matching nobody returns an empty list -- the caller renders 'Invite by email' from that", () => {
    expect(filterOrgUsersByQuery(USERS, "zzzz")).toEqual([])
  })

  test("returns id/name/email/role only -- never the employee PII /employees carries", () => {
    const withPii = [{ ...USERS[0], departmentId: "d1", reportingToId: "u1", profile: { dateOfBirth: "1990-01-01" } }]
    expect(filterOrgUsersByQuery(withPii, "arjun")).toEqual([
      { id: "u3", name: "Arjun Mehta", email: "arjun.mehta@skyline.example", role: "pm" },
    ])
  })

  test("caps the list at the picker limit", () => {
    const many = Array.from({ length: ORG_USER_PICKER_LIMIT + 5 }, (_, i) => ({
      id: `u${i}`, name: `Person ${String(i).padStart(2, "0")}`, email: `p${i}@x.example`, role: "member",
    }))
    expect(filterOrgUsersByQuery(many).length).toBe(ORG_USER_PICKER_LIMIT)
    expect(filterOrgUsersByQuery(many, "", 3).map((u) => u.name)).toEqual(["Person 00", "Person 01", "Person 02"])
  })
})
