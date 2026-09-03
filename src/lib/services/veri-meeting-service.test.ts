/// <reference types="bun-types" />
// R67 lane D22 (item D-58, rec R-187). First sibling test this service has
// ever had -- added in the same commit that widened createVeriMeeting()'s DTO
// to carry live minutes and the action items agreed in the room, per this
// repo's "New Test Coverage Check" gate.
//
// Scope is deliberately the PURE half (normalizeMeetingActionItems): the rest
// of this service is one withTenantContext transaction per function against a
// real Postgres, which this repo tests through its integration surface, not by
// mocking drizzle. The normalisation is where the create screen's real
// behaviour lives -- a repeating action-item row list always carries a
// trailing blank row, and that blank row must never become a task.
import { describe, expect, test } from "bun:test"
import { normalizeMeetingActionItems, collectAssigneeUserIds, assertAssigneesInOrg, ServiceError } from "./veri-meeting-service"
import type { TenantDb } from "@/lib/db/tenant-scoped"

describe("normalizeMeetingActionItems", () => {
  test("drops the create screen's trailing empty row instead of failing the save", () => {
    const result = normalizeMeetingActionItems([
      { title: "Close RFI-12", assigneeUserId: "usr_1", dueDate: "2026-09-10" },
      { title: "   ", assigneeUserId: "", dueDate: "" },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe("Close RFI-12")
  })

  test("trims the description and normalises blank owner/due to null, never empty string", () => {
    const [item] = normalizeMeetingActionItems([{ title: "  Order rebar  ", assigneeUserId: "  ", dueDate: "  " }])
    expect(item).toEqual({ title: "Order rebar", assigneeUserId: null, dueDate: null })
  })

  test("keeps a real owner and due date exactly as given", () => {
    const [item] = normalizeMeetingActionItems([{ title: "Sign off pour", assigneeUserId: " usr_abc ", dueDate: " 2026-09-30 " }])
    expect(item).toEqual({ title: "Sign off pour", assigneeUserId: "usr_abc", dueDate: "2026-09-30" })
  })

  test("an omitted or non-array action-item list is an empty list, not a crash", () => {
    expect(normalizeMeetingActionItems(undefined)).toEqual([])
    expect(normalizeMeetingActionItems([])).toEqual([])
  })
})

// R67 lane D22 (review finding on D-58/D-75): an action item's owner must be a
// person in the calling org. tasks.userId is a plain FK with no org predicate,
// and both write paths took the caller's id on trust.
describe("collectAssigneeUserIds", () => {
  test("returns each named owner once, ignoring the unassigned rows", () => {
    expect(collectAssigneeUserIds([
      { assigneeUserId: "u1" },
      { assigneeUserId: null },
      { assigneeUserId: "u1" },
      { assigneeUserId: "u2" },
      {},
    ])).toEqual(["u1", "u2"])
  })

  test("action items with nobody assigned name nobody to check", () => {
    expect(collectAssigneeUserIds([{ assigneeUserId: null }, {}])).toEqual([])
  })
})

describe("assertAssigneesInOrg", () => {
  // The fake stands in for the caller's transaction and answers with only the
  // rows THIS org has -- which is what compliance.users, filtered by the org
  // predicate the function builds, really returns.
  function dbWith(orgUserIds: string[]) {
    const calls: unknown[] = []
    const db = {
      query: { users: { findMany: async (args: unknown) => { calls.push(args); return orgUserIds.map((id) => ({ id })) } } },
    } as unknown as TenantDb
    return { db, calls }
  }

  test("a person in the calling org passes", async () => {
    const { db } = dbWith(["u1", "u2"])
    await expect(assertAssigneesInOrg(db, "org_a", ["u1", "u2"])).resolves.toBeUndefined()
  })

  test("an id from ANOTHER org is refused, and the message never echoes the id back", async () => {
    // The org's own directory answers with nothing for a foreign id.
    const { db } = dbWith([])
    let thrown: unknown
    try {
      await assertAssigneesInOrg(db, "org_a", ["u_from_org_b"])
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect((thrown as ServiceError).message).toBe("That person is not in your organisation")
    expect((thrown as ServiceError).message).not.toContain("u_from_org_b")
  })

  test("one bad id among good ones fails the whole save", async () => {
    const { db } = dbWith(["u1"])
    await expect(assertAssigneesInOrg(db, "org_a", ["u1", "u_foreign"])).rejects.toThrow("That person is not in your organisation")
  })

  test("no assignees means no query at all -- an unassigned action item is legitimate", async () => {
    const { db, calls } = dbWith([])
    await assertAssigneesInOrg(db, "org_a", [])
    expect(calls).toHaveLength(0)
  })
})
