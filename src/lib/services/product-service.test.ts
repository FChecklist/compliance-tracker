// Task #47 (PM feature-parity gap analysis): unit tests for the real
// project-read authorization gate, canReadProject() -- the mechanism that
// makes a 'private' project actually unreadable by an unauthorized org
// member, not just a column nobody enforces. Tests the REAL function
// against the real DbUser/role shape (no DB access needed -- canReadProject
// does no I/O), matching permission-service.test.ts's own established
// pattern for testing gates directly.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { canReadProject } from "./product-service"
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
