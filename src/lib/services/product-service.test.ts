// Task #46 (CRM feature-parity gap analysis): tests the pure
// predicates product-service.ts's new project-team-member functions rely on
// -- resolveLeadUserIdOnAdd/resolveLeadUserIdOnRemove -- rather than
// exercising the withTenantContext/live-DB-backed CRUD functions, matching
// this repo's established pattern of not touching a live DB from a
// .test.ts file (see crm-accounts-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { resolveLeadUserIdOnAdd, resolveLeadUserIdOnRemove } from "./product-service"

describe("resolveLeadUserIdOnAdd -- keeps projects.leadUserId consistent with project_team_members", () => {
  test("adding someone with role='lead' makes them the project's lead", () => {
    expect(resolveLeadUserIdOnAdd(null, "u2", "lead")).toBe("u2")
  })

  test("adding someone with role='lead' replaces the previous lead", () => {
    expect(resolveLeadUserIdOnAdd("u1", "u2", "lead")).toBe("u2")
  })

  test("adding a plain 'member' leaves the existing lead untouched", () => {
    expect(resolveLeadUserIdOnAdd("u1", "u2", "member")).toBe("u1")
  })

  test("adding a 'contributor' when there is no lead yet leaves leadUserId null", () => {
    expect(resolveLeadUserIdOnAdd(null, "u2", "contributor")).toBe(null)
  })
})

describe("resolveLeadUserIdOnRemove -- keeps projects.leadUserId consistent with project_team_members", () => {
  test("removing someone who isn't the lead leaves leadUserId untouched", () => {
    const remaining = [{ userId: "u1", role: "lead" }, { userId: "u3", role: "member" }]
    expect(resolveLeadUserIdOnRemove("u1", "u2", remaining)).toBe("u1")
  })

  test("removing the current lead falls back to another remaining lead-role member", () => {
    const remaining = [{ userId: "u2", role: "lead" }, { userId: "u3", role: "member" }]
    expect(resolveLeadUserIdOnRemove("u1", "u1", remaining)).toBe("u2")
  })

  test("removing the current lead with no other lead-role member left clears leadUserId to null", () => {
    const remaining = [{ userId: "u3", role: "member" }]
    expect(resolveLeadUserIdOnRemove("u1", "u1", remaining)).toBe(null)
  })

  test("removing the last team member (the lead) clears leadUserId to null", () => {
    expect(resolveLeadUserIdOnRemove("u1", "u1", [])).toBe(null)
  })
})
