/// <reference types="bun-types" />
// Unit tests for the vNow()/filt()/isToday() port -- pure functions, no DB,
// so these run everywhere (unlike the real-DB-gated service tests) and are
// the fast layer proving the NORMATIVE priority order before any UI is
// built on top of it. Playwright tests against the real running app (WO
// §6's 70 behaviour checks) are a separate, later layer -- these don't
// replace them, they de-risk them.
import { describe, expect, test } from "bun:test"
import { applyFilter, blocked, daysLate, dueStatus, filterCounts, heroStats, isToday, partProgress, vNow, yesFor, type ObligationRow, type ViewerContext } from "./view-model"

const NOW = new Date(2026, 8, 21) // 21 Sep 2026, matches "today" in this repo's fictional clock

function row(overrides: Partial<ObligationRow>): ObligationRow {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    part: 1,
    what: "Test job",
    dataSet: null,
    dataTypes: null,
    lawCodes: null,
    by: null,
    isGroup: false,
    due: NOW,
    yes: false,
    na: false,
    dependsOnObligationId: null,
    sent: 0,
    ...overrides,
  }
}

const owner: ViewerContext = { kind: "owner", me: "owner@example.test" }

describe("isToday", () => {
  test("SPDI ('s') and Aadhaar Act ('a') codes are in force today", () => {
    expect(isToday(["s:R4"])).toBe(true)
    expect(isToday(["a:§29"])).toBe(true)
  })
  test("DPDP ('d') and good-practice ('g') codes are NOT in force today", () => {
    expect(isToday(["d:§8(9)"])).toBe(false)
    expect(isToday(["g:"])).toBe(false)
  })
  test("a mixed set counts as today if ANY code is s/a", () => {
    expect(isToday(["d:§8(9)", "s:R5(9)"])).toBe(true)
  })
  test("empty/null is not today", () => {
    expect(isToday([])).toBe(false)
    expect(isToday(null)).toBe(false)
  })
})

describe("blocked (escalation chain)", () => {
  test("a job with no dependency is never blocked", () => {
    expect(blocked(row({ dependsOnObligationId: null }), [])).toBe(false)
  })
  test("a job is blocked while its dependency is still open", () => {
    const dep = row({ id: "dep1", yes: false })
    const r = row({ dependsOnObligationId: "dep1" })
    expect(blocked(r, [dep, r])).toBe(true)
  })
  test("a job is NOT blocked once its dependency is done", () => {
    const dep = row({ id: "dep1", yes: true })
    const r = row({ dependsOnObligationId: "dep1" })
    expect(blocked(r, [dep, r])).toBe(false)
  })
  test("an already-done job is never reported as blocked (yes short-circuits)", () => {
    const dep = row({ id: "dep1", yes: false })
    const r = row({ dependsOnObligationId: "dep1", yes: true })
    expect(blocked(r, [dep, r])).toBe(false)
  })
})

describe("vNow priority order (NORMATIVE -- do not reorder)", () => {
  test("owner: nobody-named beats everything else except go/mine (spec order: go-mine > nobody > mine > today-late > ...)", () => {
    const rows = [row({ by: null }), row({ by: "owner@example.test" })]
    const result = vNow(rows, owner, NOW)
    expect(result.action).toBe("nobody")
  })
  test("owner: with someone named for every job but some are the owner's own, 'mine' wins next", () => {
    const rows = [row({ by: "owner@example.test" }), row({ by: "someone@else.test" })]
    const result = vNow(rows, owner, NOW)
    expect(result.action).toBe("mine")
  })
  test("owner: today's-law-late beats plain late", () => {
    const past = new Date(NOW); past.setDate(past.getDate() - 5)
    const rows = [
      row({ by: "other@x.test", due: past, lawCodes: ["s:R4"] }), // required-today AND late
      row({ by: "other@x.test", due: past, lawCodes: ["d:§8(9)"] }), // just late (DPDP, not in force yet)
    ]
    const result = vNow(rows, owner, NOW)
    expect(result.action).toBe("today")
  })
  test("owner: plain late (not required-today) when nothing is required-today-late", () => {
    const past = new Date(NOW); past.setDate(past.getDate() - 5)
    const rows = [row({ by: "other@x.test", due: past, lawCodes: ["d:§8(9)"], yes: false })]
    const result = vNow(rows, owner, NOW)
    expect(result.action).toBe("late")
  })
  test("owner: everything done -> celebratory, no action button", () => {
    const rows = [row({ by: "other@x.test", yes: true })]
    const result = vNow(rows, owner, NOW)
    expect(result.title).toContain("Everything is done")
    expect(result.action).toBeUndefined()
  })
  test("owner: an empty list counts as 'everything done' (spec's !left.length branch), not 'nothing needs you'", () => {
    const result = vNow([], owner, NOW)
    expect(result.title).toContain("Everything is done")
  })
  test("owner: a live, unassigned-to-owner, not-yet-due job falls through to 'nothing needs you this week'", () => {
    const future = new Date(NOW); future.setDate(future.getDate() + 30)
    const rows = [row({ by: "someone-else@example.test", due: future, yes: false })]
    const result = vNow(rows, owner, NOW)
    expect(result.title).toContain("Nothing needs you")
  })
  test("staff: own jobs win over everything, using the staff-specific copy", () => {
    const staff: ViewerContext = { kind: "staff", me: "staff@example.test" }
    const rows = [row({ by: "staff@example.test" }), row({ by: null })]
    const result = vNow(rows, staff, NOW)
    expect(result.action).toBe("mine")
    expect(result.title).toContain("job")
  })
  test("parent: unanswered questions win", () => {
    const parent: ViewerContext = { kind: "parent", me: "You" }
    const rows = [row({ by: "You", yes: false })]
    const result = vNow(rows, parent, NOW)
    expect(result.icon).toBe("👪")
  })
  test("not-applicable rows are excluded from every branch (live())", () => {
    const rows = [row({ by: null, na: true })]
    const result = vNow(rows, owner, NOW)
    expect(result.title).not.toContain("nobody")
  })
})

describe("filterCounts / applyFilter", () => {
  const past = new Date(NOW); past.setDate(past.getDate() - 3)
  const rows = [
    row({ id: "a", by: "x@test.com", yes: true }),
    row({ id: "b", by: null, yes: false }),
    row({ id: "c", by: "owner@example.test", yes: false, due: past }),
    row({ id: "d", by: "x@test.com", yes: false, lawCodes: ["s:R4"] }),
  ]
  test("counts match a hand count", () => {
    const c = filterCounts(rows, owner, NOW)
    expect(c.all).toBe(4)
    expect(c.done).toBe(1)
    expect(c.nobody).toBe(1)
    expect(c.mine).toBe(1)
    expect(c.late).toBe(1)
    expect(c.today).toBe(1)
  })
  test("applyFilter('late') returns only the overdue row", () => {
    expect(applyFilter(rows, "late", owner, NOW).map((r) => r.id)).toEqual(["c"])
  })
  test("applyFilter('nobody') returns only the unassigned row", () => {
    expect(applyFilter(rows, "nobody", owner, NOW).map((r) => r.id)).toEqual(["b"])
  })
})

describe("dueStatus / daysLate", () => {
  test("a done row is always 'ok' even if its due date is in the past", () => {
    const past = new Date(NOW); past.setDate(past.getDate() - 10)
    expect(dueStatus(row({ yes: true, due: past }), NOW)).toBe("ok")
  })
  test("overdue and not done -> 'late', with the correct day count", () => {
    const past = new Date(NOW); past.setDate(past.getDate() - 4)
    const r = row({ due: past })
    expect(dueStatus(r, NOW)).toBe("late")
    expect(daysLate(r, NOW)).toBe(4)
  })
  test("due within 7 days -> 'soon'", () => {
    const soon = new Date(NOW); soon.setDate(soon.getDate() + 5)
    expect(dueStatus(row({ due: soon }), NOW)).toBe("soon")
  })
})

describe("partProgress / heroStats", () => {
  test("partProgress counts only that part's live rows", () => {
    const rows = [row({ part: 1, yes: true }), row({ part: 1, yes: false }), row({ part: 2, yes: true }), row({ part: 1, na: true, yes: true })]
    expect(partProgress(rows, 1)).toEqual({ done: 1, all: 2 })
  })
  test("heroStats: 0% when there are zero live rows, never NaN", () => {
    expect(heroStats([]).pct).toBe(0)
  })
  test("heroStats percentage matches done/total", () => {
    const rows = [row({ yes: true }), row({ yes: true }), row({ yes: false }), row({ yes: false })]
    expect(heroStats(rows)).toEqual({ done: 2, total: 4, pct: 50, sent: 0 })
  })
})

describe("yesFor (group jobs)", () => {
  test("a staff viewer's own group answer counts even if the group total isn't done", () => {
    const staff: ViewerContext = { kind: "staff", me: "staff@example.test" }
    const r = row({ isGroup: true, groupDone: 1, groupTotal: 1, yes: false })
    expect(yesFor(r, staff)).toBe(true)
  })
  test("a non-staff viewer reads the row's own yes flag, not group progress", () => {
    const r = row({ isGroup: true, groupDone: 0, groupTotal: 5, yes: false })
    expect(yesFor(r, owner)).toBe(false)
  })
})
