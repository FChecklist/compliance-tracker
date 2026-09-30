/// <reference types="bun-types" />
// The four job controls (owner, 2026-09-30): which a person is OFFERED, and the plain-English checks a form makes before it asks. The database is the
// real authority (dpdp_add_note / dpdp_assign_person / dpdp_set_due_date / dpdp_mark_not_applicable, drizzle/0605 + 0666); these tests pin that the page
// never offers what the database would refuse, so a person is not handed a button that only produces an error.
import { describe, expect, test } from "bun:test"
import {
  NOTE_MAX, availableActions, charCount, checkDue, checkEmail, checkNote, checkReason, dayOf, dependantCount, dueBounds, istDay, notApplicableCautions, offeredActions, requiredTodayWarning,
} from "./job-actions"
import type { ObligationRow, ViewerContext } from "./view-model"

const row = (over: Partial<ObligationRow> = {}): ObligationRow => ({
  id: "r1", part: 2, what: "Write down where it is kept", dataSet: null, dataTypes: null, lawCodes: ["d:§4"], by: "ravi@acme.in", isGroup: false,
  due: new Date("2026-10-10"), yes: false, na: false, dependsOnObligationId: null, sent: 0, ...over,
})
const viewer = (kind: ViewerContext["kind"], me = "priya@acme.in"): ViewerContext => ({ kind, me })

describe("who is offered what", () => {
  test("the owner: all four on an open job that is one person's", () => {
    expect(availableActions(row(), viewer("owner"))).toEqual(["note", "assign", "due", "na"])
  })
  test("a group job stays with its group: the owner can still note it, move its date and say it doesn't apply, but not give it to one person", () => {
    expect(availableActions(row({ isGroup: true, by: "All staff" }), viewer("owner"))).toEqual(["note", "due", "na"])
  })
  test("a finished or not-applicable job takes only a note", () => {
    expect(availableActions(row({ yes: true }), viewer("owner"))).toEqual(["note"])
    expect(availableActions(row({ na: true }), viewer("owner"))).toEqual(["note"])
  })
  test("anyone else can note; only the job's own person can say it doesn't apply; they cannot give it away or move its date", () => {
    for (const kind of ["coord", "go", "ca", "staff"] as const) {
      expect(availableActions(row(), viewer(kind)), kind).toEqual(["note"])
    }
    expect(availableActions(row({ by: "priya@acme.in" }), viewer("staff"))).toEqual(["note", "na"])
    expect(availableActions(row({ by: "Priya@Acme.in" }), viewer("coord", "priya@acme.in"))).toEqual(["note", "na"])
    // someone else's job, or a group job the staff member is only part of: not theirs to call not-applicable
    expect(availableActions(row({ by: "someone@acme.in" }), viewer("staff"))).toEqual(["note"])
    expect(availableActions(row({ isGroup: true, by: "All staff", viewerIsGroupMember: true }), viewer("staff"))).toEqual(["note"])
  })
  test("a parent answers their questions and nothing else", () => {
    expect(availableActions(row({ by: "priya@acme.in" }), viewer("parent"))).toEqual([])
  })
  test("a control the page did not wire is not offered", () => {
    const h = { onNote: async () => {}, onNotApplicable: async () => {} }
    expect(offeredActions(row(), viewer("owner"), h)).toEqual(["note", "na"])
    expect(offeredActions(row(), viewer("owner"), {})).toEqual([])
  })
})

describe("the checks a form makes before it asks", () => {
  test("a note: some words, trimmed, at most 1000 characters", () => {
    expect(checkNote("   ")).toEqual({ ok: false, message: "Write a few words first." })
    expect(checkNote("  hello  ")).toEqual({ ok: true, value: "hello" })
    expect(checkNote("x".repeat(NOTE_MAX))).toEqual({ ok: true, value: "x".repeat(NOTE_MAX) })
    const long = checkNote("x".repeat(NOTE_MAX + 1))
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.message).toContain("1000 characters at most (this one is 1001)")
  })
  test("an email address: a full one, lower-cased", () => {
    expect(checkEmail(" Ravi@Acme.IN ")).toEqual({ ok: true, value: "ravi@acme.in" })
    for (const bad of ["", "ravi", "ravi@acme", "ra vi@acme.in", "<ravi@acme.in>", "@acme.in", "a@b..c", "a@b.c.", "a@.b.co", "a..b@acme.in", ".a@acme.in", "a.@acme.in", "a@acme.i", "a@-.co"]) {
      expect(checkEmail(bad).ok, bad).toBe(false)
    }
    for (const good of ["ravi@acme.in", "ravi.k+dpdp@sub.acme.co.in", "r_v@acme-corp.com"]) expect(checkEmail(good).ok, good).toBe(true)
  })
  test("length is counted in characters, the way the database counts: an emoji is one, not two", () => {
    expect(charCount("😀😀")).toBe(2)
    expect(checkNote("😀".repeat(NOTE_MAX)).ok).toBe(true)
    expect(checkNote("😀".repeat(NOTE_MAX + 1)).ok).toBe(false)
    expect(checkReason("😀".repeat(NOTE_MAX + 1)).ok).toBe(false)
  })
  test("a not-applicable reason: a few words, and they are kept", () => {
    expect(checkReason("no")).toMatchObject({ ok: false })
    expect(checkReason("  We have no cameras. ")).toEqual({ ok: true, value: "We have no cameras." })
    expect(checkReason("x".repeat(NOTE_MAX + 1)).ok).toBe(false)
  })
  test("a due date: within 30 days back and 400 days ahead of India's today", () => {
    const now = new Date("2026-10-05T10:00:00Z")
    expect(dueBounds(now)).toEqual({ min: "2026-09-05", max: "2027-11-09" })
    expect(checkDue("2026-09-05", now)).toEqual({ ok: true, value: "2026-09-05" })
    expect(checkDue("2027-11-09", now)).toEqual({ ok: true, value: "2027-11-09" })
    expect(checkDue("2026-09-04", now)).toMatchObject({ ok: false })
    expect(checkDue("2027-11-10", now)).toMatchObject({ ok: false })
    expect(checkDue("", now)).toEqual({ ok: false, message: "Pick a date." })
    expect(checkDue("05/10/2026", now)).toEqual({ ok: false, message: "Pick a date." })
  })
  test("India's day, not the browser's: an evening in UTC is already tomorrow in India", () => {
    expect(istDay(new Date("2026-10-05T20:00:00Z"))).toBe("2026-10-06")
    expect(istDay(new Date("2026-10-05T10:00:00Z"))).toBe("2026-10-05")
    expect(dueBounds(new Date("2026-10-05T20:00:00Z")).min).toBe("2026-09-06")
  })
  test("a due date is read as its own calendar day in any time zone", () => {
    expect(dayOf(new Date("2026-10-10"))).toBe("2026-10-10")
  })
  test("saying 'doesn't apply' warns who it lets through, and what it may do to a role holder's own view", () => {
    const step = row({ id: "s1", by: "owner@acme.in" })
    const next = row({ id: "s2", by: "mgr@acme.in", dependsOnObligationId: "s1" })
    const done = row({ id: "s3", by: "x@acme.in", dependsOnObligationId: "s1", yes: true })
    expect(dependantCount(step, [step, next, done])).toBe(1)
    expect(notApplicableCautions(step, viewer("owner"), [step, next, done])).toEqual(["Another job is waiting for this one. Saying it doesn't apply lets it go ahead."])
    expect(notApplicableCautions(step, viewer("owner"), [step, next, { ...next, id: "s4" }])[0]).toContain("2 other jobs are waiting for this one")
    expect(notApplicableCautions(step, viewer("owner"), [step])).toEqual([])
    const mine = row({ by: "priya@acme.in" })
    expect(notApplicableCautions(mine, viewer("go"), [mine])[0]).toContain("you may see only your own jobs")
    expect(notApplicableCautions(mine, viewer("staff"), [mine])).toEqual([])
    expect(notApplicableCautions(row({ by: "someone@acme.in" }), viewer("go"), [mine])).toEqual([])
  })
  test("only a job today's law is behind gets the warning", () => {
    expect(requiredTodayWarning(row({ lawCodes: ["d:§4"] }))).toBeNull()
    expect(requiredTodayWarning(row({ lawCodes: ["g:"] }))).toBeNull()
    expect(requiredTodayWarning(row({ lawCodes: ["d:§8(9)", "s:R5(9)"] }))).toContain("Today's law (the SPDI Rules 2011 or the Aadhaar Act) is behind this job")
    expect(requiredTodayWarning(row({ lawCodes: ["a:§29"] }))).not.toBeNull()
  })
})
