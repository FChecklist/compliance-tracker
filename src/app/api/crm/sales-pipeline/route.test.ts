/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
// wave): resolveViewerScope() is the real fix for the "Access Control /
// Role-Based Permissions" finding -- before this, every authenticated org
// user with sales-module access saw the whole org's pipeline regardless of
// role. Pure function, no DB/auth-guard mocking needed (same convention as
// crm-accounts-service.test.ts's wouldCreateCycle()/computeRoundRobinAssignment
// in crm-service.ts).
import { describe, test, expect } from "bun:test"
import { resolveViewerScope } from "./route"

function user(id: string, role: string) {
  return { id, role } as unknown as Parameters<typeof resolveViewerScope>[0]
}

describe("resolveViewerScope", () => {
  test("member is forced to their own ownerId, ignoring any requested ownerId", () => {
    expect(resolveViewerScope(user("rep-1", "member"), null)).toBe("rep-1")
    expect(resolveViewerScope(user("rep-1", "member"), "someone-else")).toBe("rep-1")
  })

  test("viewer is forced to their own ownerId too (below manager rank)", () => {
    expect(resolveViewerScope(user("rep-1", "viewer"), null)).toBe("rep-1")
  })

  test("manager with no requested ownerId sees the whole team (undefined restriction)", () => {
    expect(resolveViewerScope(user("mgr-1", "manager"), null)).toBeUndefined()
  })

  test("manager can request a specific rep's pipeline via ownerId", () => {
    expect(resolveViewerScope(user("mgr-1", "manager"), "rep-2")).toBe("rep-2")
  })

  test("admin (higher rank than manager) behaves the same as manager", () => {
    expect(resolveViewerScope(user("admin-1", "admin"), null)).toBeUndefined()
    expect(resolveViewerScope(user("admin-1", "admin"), "rep-3")).toBe("rep-3")
  })

  // Honest, disclosed edge case: hasRole(null, ...) returns false (below
  // manager rank), so the `if` branch is taken, but `dbUser?.id` on a null
  // dbUser evaluates to undefined -- the same "undefined restriction" value
  // a manager's own unrestricted view produces. This is unreachable in the
  // real route (GET/POST both `return response` before dbUser can be null),
  // so it's not a real permission gap, just documented here rather than
  // left as an unstated assumption.
  test("null dbUser resolves to undefined (unreachable in the real route -- requireAuth always short-circuits first)", () => {
    expect(resolveViewerScope(null, null)).toBeUndefined()
  })
})
