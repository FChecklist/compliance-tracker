// Task #46 (CRM feature-parity gap analysis): tests the pure predicate
// crm-service.ts exports for deterministic auto-assignment --
// computeRoundRobinAssignment() -- rather than exercising the
// withTenantContext/live-DB-backed functions that call it
// (autoDistributeLeads/autoDistributeOpportunities/getAssignmentOverview),
// matching this repo's established pattern of not touching a live DB from
// a .test.ts file (see crm-accounts-service.test.ts's own header note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeRoundRobinAssignment } from "./crm-service"

describe("computeRoundRobinAssignment -- deterministic, zero-AI load-balanced distribution", () => {
  test("distributes evenly round-robin across multiple active users (Auto Assign mode, no cap)", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4"],
      ["u1", "u2"]
    )
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("more unassigned records than users -- uneven totals, still deterministic round-robin order", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2", "u3"]
    )
    // 5 records / 3 users: u1 and u2 get 2, u3 gets 1 -- round-robin order,
    // not sorted-by-count.
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3", "u1", "u2"])
    expect(perUser).toEqual({ u1: 2, u2: 2, u3: 1 })
  })

  test("zero unassigned records is a real no-op -- empty assignments, zeroed perUser counts", () => {
    const { assignments, perUser } = computeRoundRobinAssignment([], ["u1", "u2"])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({ u1: 0, u2: 0 })
  })

  test("zero active users is also a no-op regardless of how many records are unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2"], [])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({})
  })

  test("all users at capacity (sharingCount) -- stops placing once every user hits the cap, remainder stays unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2"],
      2 // sharingCount: each user takes at most 2
    )
    // u1<-r1, u2<-r2, u1<-r3, u2<-r4 -- both users now at cap (2 each).
    // r5 cannot be placed anywhere; the function stops rather than
    // scanning the rest of the (empty) queue for no effect.
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("sharingCount honored per-user even with an uneven pool size", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3"],
      ["u1", "u2", "u3"],
      1 // each of the 3 users gets exactly 1 -- exactly enough capacity for 3 records
    )
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3"])
    expect(perUser).toEqual({ u1: 1, u2: 1, u3: 1 })
  })

  test("single user pool with no cap absorbs every unassigned record", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2", "r3"], ["u1"])
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.userId === "u1")).toBe(true)
    expect(perUser).toEqual({ u1: 3 })
  })
})
