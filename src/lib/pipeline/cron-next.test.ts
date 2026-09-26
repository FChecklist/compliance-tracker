/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-40: the cron arithmetic the scheduler bridge moves next_run_at with (cron-next.ts). Pure, no clock, no I/O.
// Every expected time below was worked out by hand from the calendar (2026-09-25 is a Friday), not by running the function.
// Run: bun test --isolate src/lib/pipeline/cron-next.test.ts
import { describe, expect, test } from "bun:test"
import { nextCronRun, parseCron } from "./cron-next"

const at = (iso: string) => new Date(iso)
const next = (expr: string, after: string) => nextCronRun(expr, at(after))?.toISOString() ?? null

describe("nextCronRun: the next minute strictly after the given instant", () => {
  test("every five minutes rounds up to the next multiple, and an instant that is already on one moves to the following one", () => {
    expect(next("*/5 * * * *", "2026-09-25T09:32:10.500Z")).toBe("2026-09-25T09:35:00.000Z")
    expect(next("*/5 * * * *", "2026-09-25T09:35:00.000Z")).toBe("2026-09-25T09:40:00.000Z")
    expect(next("*/5 * * * *", "2026-09-25T09:59:59.999Z")).toBe("2026-09-25T10:00:00.000Z")
  })

  test("a daily time moves to the next day once today's slot has been used", () => {
    expect(next("30 9 * * *", "2026-09-25T09:29:59.000Z")).toBe("2026-09-25T09:30:00.000Z")
    expect(next("30 9 * * *", "2026-09-25T09:30:00.000Z")).toBe("2026-09-26T09:30:00.000Z")
  })

  test("month, year and end-of-month rollovers", () => {
    expect(next("0 0 1 * *", "2026-09-25T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z")
    expect(next("0 0 1 1 *", "2026-12-31T23:59:00.000Z")).toBe("2027-01-01T00:00:00.000Z")
    expect(next("0 0 31 * *", "2026-09-25T00:00:00.000Z")).toBe("2026-10-31T00:00:00.000Z") // September has no 31st
    expect(next("59 23 * * *", "2026-12-31T23:58:30.000Z")).toBe("2026-12-31T23:59:00.000Z")
  })

  test("lists, ranges and steps inside a range", () => {
    expect(next("0,30 * * * *", "2026-09-25T09:10:00.000Z")).toBe("2026-09-25T09:30:00.000Z")
    expect(next("10-20/5 8 * * *", "2026-09-25T08:11:00.000Z")).toBe("2026-09-25T08:15:00.000Z")
    expect(next("10-20/5 8 * * *", "2026-09-25T08:20:00.000Z")).toBe("2026-09-26T08:10:00.000Z")
    expect(next("0 8-10 * * *", "2026-09-25T10:00:00.000Z")).toBe("2026-09-26T08:00:00.000Z")
  })

  test("weekdays: a Friday evening moves to Monday, and 7 means Sunday like 0", () => {
    expect(next("0 9 * * 1-5", "2026-09-25T10:00:00.000Z")).toBe("2026-09-28T09:00:00.000Z") // Fri 25 -> Mon 28
    expect(next("0 9 * * 7", "2026-09-25T00:00:00.000Z")).toBe("2026-09-27T09:00:00.000Z") // Sunday 27
    expect(next("0 9 * * 0", "2026-09-25T00:00:00.000Z")).toBe("2026-09-27T09:00:00.000Z")
  })

  test("names for the month and the weekday", () => {
    expect(next("0 12 * * mon-fri", "2026-09-26T00:00:00.000Z")).toBe("2026-09-28T12:00:00.000Z") // Saturday -> Monday
    expect(next("0 0 1 JAN *", "2026-09-25T00:00:00.000Z")).toBe("2027-01-01T00:00:00.000Z")
  })

  test("day-of-month and day-of-week both restricted: either one matches (standard cron)", () => {
    // the 13th OR a Friday: from Sat 26 Sep 2026 the next Friday is 2 Oct, before the 13th of October
    expect(next("0 0 13 * 5", "2026-09-26T00:00:00.000Z")).toBe("2026-10-02T00:00:00.000Z")
    // from Sun 4 Oct the next match is Fri 9 Oct, then the 13th (Tuesday) comes before the next Friday the 16th
    expect(next("0 0 13 * 5", "2026-10-10T00:00:00.000Z")).toBe("2026-10-13T00:00:00.000Z")
  })

  test("day-of-month restricted and day-of-week starting with a star: both must match", () => {
    expect(next("0 0 15 * *", "2026-09-25T00:00:00.000Z")).toBe("2026-10-15T00:00:00.000Z")
    // */3 in the weekday field is 0,3,6 (Sunday, Wednesday, Saturday). 15 Oct 2026 is a Thursday, so October is skipped;
    // 15 Nov 2026 is a Sunday.
    expect(next("0 0 15 * */3", "2026-09-25T00:00:00.000Z")).toBe("2026-11-15T00:00:00.000Z")
  })

  test("a leap day waits for the next leap year, and a date that never exists gives null", () => {
    expect(next("0 0 29 2 *", "2026-09-25T00:00:00.000Z")).toBe("2028-02-29T00:00:00.000Z")
    expect(next("0 0 31 2 *", "2026-09-25T00:00:00.000Z")).toBeNull()
    expect(next("0 0 30 2 *", "2026-09-25T00:00:00.000Z")).toBeNull()
  })

  test("the result is always whole minutes in UTC and strictly after the input", () => {
    const after = at("2026-09-25T09:30:00.000Z")
    for (const expr of ["* * * * *", "*/5 * * * *", "30 9 * * *", "0 * * * *"]) {
      const out = nextCronRun(expr, after)!
      expect(out.getTime()).toBeGreaterThan(after.getTime())
      expect(out.getUTCSeconds()).toBe(0)
      expect(out.getUTCMilliseconds()).toBe(0)
    }
  })

  test("an unusable expression or an invalid date gives null", () => {
    expect(nextCronRun("not a cron", at("2026-09-25T00:00:00.000Z"))).toBeNull()
    expect(nextCronRun("* * * * *", new Date(Number.NaN))).toBeNull()
  })
})

describe("parseCron: what is refused, and why", () => {
  test("the wrong number of fields", () => {
    for (const expr of ["", "   ", "* * * *", "* * * * * *", "@daily"]) {
      const r = parseCron(expr)
      expect(r.ok).toBe(false)
    }
    const four = parseCron("* * * *")
    expect(four.ok ? "" : four.reason).toContain("expected 5 fields")
  })

  test("values outside a field's range", () => {
    for (const expr of ["60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *", "* * * 13 *", "* * * 0 *", "* * * * 8"]) {
      expect(parseCron(expr).ok).toBe(false)
    }
  })

  test("a step of 0, a step on a single value, a reversed range, an empty list item, stray text", () => {
    for (const expr of ["*/0 * * * *", "5/15 * * * *", "20-10 * * * *", "1,,2 * * * *", "a * * * *", "1-2-3 * * * *", "*/5/2 * * * *", "-5 * * * *"]) {
      expect(parseCron(expr).ok).toBe(false)
    }
  })

  test("valid expressions parse to the sets they name", () => {
    const r = parseCron("*/15 0,12 1-3 jan-mar sun")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect([...r.cron.minute]).toEqual([0, 15, 30, 45])
      expect([...r.cron.hour]).toEqual([0, 12])
      expect([...r.cron.dayOfMonth]).toEqual([1, 2, 3])
      expect([...r.cron.month]).toEqual([1, 2, 3])
      expect([...r.cron.dayOfWeek]).toEqual([0])
      expect(r.cron.dayOfMonthStar).toBe(false)
      expect(r.cron.dayOfWeekStar).toBe(false)
    }
  })
})
