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
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
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
