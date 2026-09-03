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

// R67 D-16 (PROJEXA MoM list: real Attendees / Open actions columns).
//
// veri-meeting-service.ts had NO sibling test before this file, which is why
// the "New Test Coverage Check" CI gate requires one in the same commit that
// touches it. Same convention as construction-boq-service.test.ts /
// esignature-service.test.ts: the DB-touching functions
// (listVeriMeetings/createVeriMeeting/...) run inside withTenantContext and
// are deliberately NOT exercised here -- what is tested is the pure
// arithmetic those functions were carrying inline, extracted for exactly
// this reason:
//
//   countAttendees()               -- how many attendees a jsonb column holds
//   attachMeetingListAggregates()  -- joining the ONE grouped open-action-item
//                                     query back onto the meeting rows
//
// The defect these guard against is the list quietly reporting a wrong
// number: "0 open actions" for a meeting that has three, or a crash on a
// malformed attendees column taking the whole list down.
// Merge note (D22 with lane D-16): both lanes created this file in the same
// place at the same time, each as the sibling test the "New Test Coverage
// Check" gate demands. Both sets of tests are kept; only the duplicated
// `/// <reference>` and the duplicated `bun:test` import were dropped, since a
// repeated import binding is a redeclaration error rather than a style point.
import {
  CLOSED_ACTION_ITEM_STATUSES,
  attachMeetingListAggregates,
  countAttendees,
} from "./veri-meeting-service"

describe("countAttendees", () => {
  test("counts a normal string[] attendees column", () => {
    expect(countAttendees(["Arjun Mehta", "Priya Nair", "Sumeet"])).toBe(3)
  })

  test("the schema default -- an empty array -- is zero, not unknown", () => {
    expect(countAttendees([])).toBe(0)
  })

  test("blank and whitespace-only entries are not attendees", () => {
    expect(countAttendees(["Arjun Mehta", "", "   ", "Priya Nair"])).toBe(2)
  })

  test("a malformed column (null, a string, an object) is 0 and never throws -- one bad row must not take a 50-row list down", () => {
    expect(countAttendees(null)).toBe(0)
    expect(countAttendees(undefined)).toBe(0)
    expect(countAttendees("Arjun Mehta")).toBe(0)
    expect(countAttendees({ 0: "Arjun Mehta", length: 1 })).toBe(0)
  })

  test("a non-string element is still counted -- under-reporting a real attendee is the defect this column exists to remove", () => {
    expect(countAttendees([{ name: "Arjun Mehta" }, "Priya Nair"])).toBe(2)
    // ...but a null hole in the array is not a person.
    expect(countAttendees(["Arjun Mehta", null, undefined])).toBe(1)
  })
})

describe("attachMeetingListAggregates", () => {
  const meetings = [
    { id: "m1", title: "Site coordination", attendees: ["A", "B"] },
    { id: "m2", title: "Client review", attendees: [] },
    { id: "m3", title: "Safety walk", attendees: ["A", "B", "C", "D"] },
  ]

  test("each row gets the count from its own group row", () => {
    const rows = attachMeetingListAggregates(meetings, [
      { meetingId: "m1", openCount: 3 },
      { meetingId: "m3", openCount: 1 },
    ])
    expect(rows.map((r) => [r.id, r.openActionItems])).toEqual([
      ["m1", 3],
      ["m2", 0],
      ["m3", 1],
    ])
  })

  test("a meeting the grouped query returned no row for has ZERO open actions -- the query covered every id, so absence is a real zero", () => {
    const rows = attachMeetingListAggregates(meetings, [{ meetingId: "m1", openCount: 2 }])
    expect(rows.find((r) => r.id === "m2")!.openActionItems).toBe(0)
    expect(rows.find((r) => r.id === "m3")!.openActionItems).toBe(0)
  })

  test("attendeesCount is computed per row", () => {
    const rows = attachMeetingListAggregates(meetings, [])
    expect(rows.map((r) => r.attendeesCount)).toEqual([2, 0, 4])
  })

  test("every original field survives -- this is additive, never a replacement DTO", () => {
    const [row] = attachMeetingListAggregates(meetings, [{ meetingId: "m1", openCount: 5 }])
    expect(row.title).toBe("Site coordination")
    expect(row.attendees).toEqual(["A", "B"])
    expect(row.openActionItems).toBe(5)
  })

  test("row order is preserved (the service orders by scheduledAt desc; the aggregate join must not reshuffle it)", () => {
    const rows = attachMeetingListAggregates(meetings, [{ meetingId: "m3", openCount: 1 }])
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"])
  })

  test("an empty meeting list yields an empty list, not a throw", () => {
    expect(attachMeetingListAggregates([], [])).toEqual([])
  })

  test("a non-numeric count coming back from the driver degrades to 0 rather than rendering NaN in a table cell", () => {
    const rows = attachMeetingListAggregates(meetings, [
      { meetingId: "m1", openCount: "4" as unknown as number },
      { meetingId: "m2", openCount: Number.NaN },
    ])
    expect(rows.find((r) => r.id === "m1")!.openActionItems).toBe(4)
    expect(rows.find((r) => r.id === "m2")!.openActionItems).toBe(0)
  })
})

describe("CLOSED_ACTION_ITEM_STATUSES", () => {
  test("matches listMyMeetingActionItems()'s own definition of 'still open' -- one definition, not two that drift", () => {
    expect([...CLOSED_ACTION_ITEM_STATUSES]).toEqual(["completed", "cancelled"])
  })
})
