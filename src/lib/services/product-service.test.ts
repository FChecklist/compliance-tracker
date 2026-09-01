// Task #47 (PM feature-parity gap analysis): unit tests for the real
// project-read authorization gate, canReadProject() -- the mechanism that
// makes a 'private' project actually unreadable by an unauthorized org
// member, not just a column nobody enforces. Tests the REAL function
// against the real DbUser/role shape (no DB access needed -- canReadProject
// does no I/O), matching permission-service.test.ts's own established
// pattern for testing gates directly.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { canReadProject, resolveLeadUserIdOnAdd, resolveLeadUserIdOnRemove } from "./product-service"
import type { users, projects } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"

type DbUser = typeof users.$inferSelect
type Project = Pick<typeof projects.$inferSelect, "accessLevel" | "leadUserId">

function userWithRole(id: string, role: UserRole): DbUser {
  return { id, role } as unknown as DbUser
}

describe("canReadProject", () => {
  test("a 'public' project is readable by any authenticated org member, regardless of role", () => {
    const project: Project = { accessLevel: "public", leadUserId: "user-lead" }
    expect(canReadProject(project, userWithRole("user-other", "viewer"))).toBe(true)
    expect(canReadProject(project, userWithRole("user-other", "member"))).toBe(true)
  })

  test("a 'public' project is readable even with no session at all", () => {
    const project: Project = { accessLevel: "public", leadUserId: "user-lead" }
    expect(canReadProject(project, null)).toBe(true)
  })

  test("a 'private' project is refused for an unauthenticated caller", () => {
    const project: Project = { accessLevel: "private", leadUserId: "user-lead" }
    expect(canReadProject(project, null)).toBe(false)
  })

  test("a 'private' project is refused for a real org member who is neither the lead nor an admin -- the core access-control guarantee", () => {
    const project: Project = { accessLevel: "private", leadUserId: "user-lead" }
    expect(canReadProject(project, userWithRole("user-unrelated", "member"))).toBe(false)
    expect(canReadProject(project, userWithRole("user-unrelated", "manager"))).toBe(false)
  })

  test("a 'private' project is readable by its own leadUserId, even at the lowest role rank", () => {
    const project: Project = { accessLevel: "private", leadUserId: "user-lead" }
    expect(canReadProject(project, userWithRole("user-lead", "viewer"))).toBe(true)
  })

  test("a 'private' project is readable by an admin who is not the lead", () => {
    const project: Project = { accessLevel: "private", leadUserId: "user-lead" }
    expect(canReadProject(project, userWithRole("user-admin", "admin"))).toBe(true)
    expect(canReadProject(project, userWithRole("user-admin", "veridian_admin"))).toBe(true)
  })

  test("a 'private' project with no leadUserId set is still refused for a non-admin member (never falls open)", () => {
    const project: Project = { accessLevel: "private", leadUserId: null }
    expect(canReadProject(project, userWithRole("user-other", "member"))).toBe(false)
  })
})

// Task #46 (CRM feature-parity gap analysis): tests the pure
// predicates product-service.ts's new project-team-member functions rely on
// -- resolveLeadUserIdOnAdd/resolveLeadUserIdOnRemove -- rather than
// exercising the withTenantContext/live-DB-backed CRUD functions, matching
// this repo's established pattern of not touching a live DB from a
// .test.ts file (see crm-accounts-service.test.ts's own note on this).
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
