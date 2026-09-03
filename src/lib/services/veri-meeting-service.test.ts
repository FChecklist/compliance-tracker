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
// + R67 D-17 / D-21 (MoM delete rule and the PROJEXA-branded share link).
//
// veri-meeting-service.ts had NO sibling test before this programme, so TWO
// lanes each wrote this file from scratch and the integration train met an
// add/add conflict rather than a textual one. BOTH halves are kept in full --
// they test disjoint pure helpers and share no fixtures.
//
// Same convention as construction-boq-service.test.ts / esignature-service
// .test.ts: the DB-touching functions (listVeriMeetings/createVeriMeeting/...)
// run inside withTenantContext and are deliberately NOT exercised here --
// what is tested is the pure arithmetic and the pure rules those functions
// were carrying inline, extracted for exactly this reason:
//
//   countAttendees()               -- how many attendees a jsonb column holds
//   attachMeetingListAggregates()  -- joining the ONE grouped open-action-item
//                                     query back onto the meeting rows
//   canDeleteMeeting()             -- only a DRAFT is deletable
//   resolveShareOrigin() and friends -- the share URL and its wording
//
// The defects these guard against are the ones the audit actually recorded:
//   D-16  the list quietly reporting a wrong number ("0 open actions" for a
//         meeting that has three), or crashing on a malformed attendees
//         column and taking the whole list down.
//   D-17  Delete was ABSENT on a published meeting rather than disabled with
//         a reason, so the rule "only a draft can be deleted" existed nowhere
//         a reader could check it.
//   D-21  the share message named VERIDIAN to a PROJEXA customer and built
//         its URL from request.nextUrl.origin -- for a server-to-server call
//         that is VERIDIAN's own deployment host, never the product domain
//         the recipient has to open.
//   D-58  (lane D22) the pure half of the create DTO -- a repeating
//         action-item row list always carries a trailing blank row, and that
//         blank row must never become a task -- plus the org boundary on
//         every assignee id.
//
// Merge note (lane D22 with lanes D-16/D-17/D-21): all of them created this
// file in the same place, each as the sibling test the "New Test Coverage
// Check" gate demands. Every set of tests is kept; only the duplicated
// `/// <reference>` and the duplicated `bun:test` import were dropped, since a
// repeated import binding is a redeclaration error rather than a style point.
import {
  CLOSED_ACTION_ITEM_STATUSES,
  attachMeetingListAggregates,
  countAttendees,
  canDeleteMeeting,
  MEETING_DELETE_BLOCKED_REASON,
  MEETING_DELETED_STATUS,
  normaliseShareBrand,
  resolveShareOrigin,
  formatShareDate,
  composeMeetingShareTarget,
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


describe("canDeleteMeeting (D-17: the rule the disabled button states)", () => {
  test("a draft is deletable", () => {
    expect(canDeleteMeeting("draft")).toBe(true)
  })

  test("a published meeting is not -- it is the locked record publish/lock exists to protect", () => {
    expect(canDeleteMeeting("published")).toBe(false)
  })

  test("an already soft-deleted meeting is not deletable a second time", () => {
    expect(canDeleteMeeting(MEETING_DELETED_STATUS)).toBe(false)
  })

  test("the refusal sentence is the exact string the UI renders beside a disabled Delete", () => {
    // If these two ever drift, the user reads one reason and the server gives
    // another. Pinned here on purpose.
    expect(MEETING_DELETE_BLOCKED_REASON).toBe("Published meetings cannot be deleted")
  })
})

describe("resolveShareOrigin (D-21: never the request's own origin when a real one was passed)", () => {
  const FALLBACK = "https://veridian-compliance-ai.vercel.app"

  test("a valid absolute origin wins over the request origin", () => {
    expect(resolveShareOrigin("https://projexa-ai.com", FALLBACK)).toBe("https://projexa-ai.com")
  })

  test("a path/query on the supplied value is stripped to the origin", () => {
    expect(resolveShareOrigin("https://projexa-ai.com/some/path?x=1", FALLBACK)).toBe("https://projexa-ai.com")
  })

  test("a localhost origin with a port is preserved, so local runs share a link that actually opens", () => {
    expect(resolveShareOrigin("http://localhost:3100", FALLBACK)).toBe("http://localhost:3100")
  })

  test("an empty, blank, non-URL or non-http value falls back instead of throwing", () => {
    for (const bad of ["", "   ", "projexa-ai.com", "javascript:alert(1)", "file:///etc/passwd", null, undefined, 42]) {
      expect(resolveShareOrigin(bad, FALLBACK)).toBe(FALLBACK)
    }
  })
})

describe("normaliseShareBrand", () => {
  test("only the literal 'projexa' selects the PROJEXA brand", () => {
    expect(normaliseShareBrand("projexa")).toBe("projexa")
  })

  test("anything else -- including a missing body -- stays on the pre-D-21 VERIDIAN wording", () => {
    for (const value of [undefined, null, "", "VERIDIAN", "Projexa", 1, {}]) {
      expect(normaliseShareBrand(value)).toBe("veridian")
    }
  })
})

describe("formatShareDate", () => {
  test("renders in the requested locale, pinned to UTC so the same instant never reads as two dates", () => {
    expect(formatShareDate("2026-08-28T18:30:00.000Z", "en-GB")).toBe("28 Aug 2026")
  })

  test("accepts a Date as well as an ISO string", () => {
    expect(formatShareDate(new Date("2026-08-28T00:00:00.000Z"), "en-GB")).toBe("28 Aug 2026")
  })

  test("an unparseable date yields an empty string rather than 'Invalid Date' in a WhatsApp message", () => {
    expect(formatShareDate("not a date")).toBe("")
  })
})

describe("composeMeetingShareTarget (D-21 acceptance)", () => {
  const BASE = {
    token: "tok_abc123",
    title: "Weekly Site Coordination - Villa 21",
    scheduledAt: "2026-08-28T09:00:00.000Z",
    projectName: "Villa 21",
    fallbackOrigin: "https://veridian-compliance-ai.vercel.app",
  }

  test("the PROJEXA message starts with 'Minutes of Meeting - ' and the URL origin is the PASSED shareOrigin, never the request origin", () => {
    const shareOrigin = "https://projexa-ai.com"
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin })

    expect(result.message.startsWith("Minutes of Meeting - ")).toBe(true)
    expect(new URL(result.shareUrl).origin).toBe(shareOrigin)
    expect(result.shareUrl).not.toContain("veridian-compliance-ai.vercel.app")
    expect(result.message).not.toContain("veridian-compliance-ai.vercel.app")
  })

  test("the whole PROJEXA sentence is title, date, project, link -- in that order", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.message).toBe(
      "Minutes of Meeting - Weekly Site Coordination - Villa 21, 28 Aug 2026, Villa 21: https://projexa-ai.com/shared/mom/tok_abc123"
    )
  })

  test("a meeting with no project drops the project clause rather than printing a placeholder", () => {
    const result = composeMeetingShareTarget({ ...BASE, projectName: null, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.message).toBe(
      "Minutes of Meeting - Weekly Site Coordination - Villa 21, 28 Aug 2026: https://projexa-ai.com/shared/mom/tok_abc123"
    )
  })

  test("the PROJEXA link points at PROJEXA's public page, not VERIDIAN's /shared/meeting", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(new URL(result.shareUrl).pathname).toBe("/shared/mom/tok_abc123")
  })

  test("the WhatsApp href carries the composed sentence, url-encoded", () => {
    const result = composeMeetingShareTarget({ ...BASE, brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.whatsappHref).toBe(`https://wa.me/?text=${encodeURIComponent(result.message)}`)
  })

  test("a caller that sends no brand and no origin is byte-identical to the pre-D-21 behaviour", () => {
    const result = composeMeetingShareTarget(BASE)
    expect(result.brand).toBe("veridian")
    expect(result.shareUrl).toBe("https://veridian-compliance-ai.vercel.app/shared/meeting/tok_abc123")
    expect(result.message).toBe(
      "View these VERIDIAN AI meeting minutes: https://veridian-compliance-ai.vercel.app/shared/meeting/tok_abc123"
    )
  })

  test("a token with URL-unsafe characters is encoded into the path", () => {
    const result = composeMeetingShareTarget({ ...BASE, token: "a b/c", brand: "projexa", shareOrigin: "https://projexa-ai.com" })
    expect(result.shareUrl).toBe("https://projexa-ai.com/shared/mom/a%20b%2Fc")
  })
})
