/// <reference types="bun-types" />
// Owner directive 2026-07-13: tests the pure validation/decision functions
// -- createReportSchedule()/runDueReportSchedules() themselves touch the
// DB and are deliberately left untested here, matching this repo's
// established pattern (see delegation-service.test.ts's own note).
//
// Priority 11 (2026-07-13, Reports & Analysis Engine): expanded alongside
// isScheduleDue()'s move from a closed 3-cadence set to the full
// report-taxonomy.ts periodicity vocabulary. The old "rejects an invalid
// cadence" test used "yearly" as its example -- that's now a genuinely
// valid periodicity, so it's replaced with an actually-invalid string
// below rather than left silently wrong.
import { describe, expect, test } from "bun:test"
import { validateReportScheduleInput, isScheduleDue, matchesTimeOfDay } from "./report-schedule-service"

describe("validateReportScheduleInput", () => {
  test("valid: daily cadence needs no day fields", () => {
    expect(validateReportScheduleInput({ reportId: "escalations", cadence: "daily", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] }))
      .toEqual({ valid: true })
  })

  test("valid: weekly cadence with dayOfWeek", () => {
    expect(validateReportScheduleInput({ reportId: "escalations", cadence: "weekly", dayOfWeek: 1, dayOfMonth: null, recipientUserIds: ["u1"] }))
      .toEqual({ valid: true })
  })

  test("valid: monthly cadence with dayOfMonth", () => {
    expect(validateReportScheduleInput({ reportId: "escalations", cadence: "monthly", dayOfWeek: null, dayOfMonth: 15, recipientUserIds: ["u1"] }))
      .toEqual({ valid: true })
  })

  test("valid: yearly cadence with dayOfMonth", () => {
    expect(validateReportScheduleInput({ reportId: "escalations", cadence: "yearly", dayOfWeek: null, dayOfMonth: 1, recipientUserIds: ["u1"] }))
      .toEqual({ valid: true })
  })

  test("valid: custom_range with startDate/endDate", () => {
    expect(validateReportScheduleInput({ reportId: "r1", cadence: "custom_range", dayOfWeek: null, dayOfMonth: null, startDate: "2026-08-01", endDate: "2026-08-31", recipientUserIds: ["u1"] }))
      .toEqual({ valid: true })
  })

  test("valid: hourly/on_demand need no day fields", () => {
    expect(validateReportScheduleInput({ reportId: "r1", cadence: "hourly", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })).toEqual({ valid: true })
    expect(validateReportScheduleInput({ reportId: "r1", cadence: "on_demand", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })).toEqual({ valid: true })
  })

  test("rejects an empty reportId", () => {
    const result = validateReportScheduleInput({ reportId: "  ", cadence: "daily", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects an invalid cadence", () => {
    // @ts-expect-error deliberately invalid for the test -- "sometimes" is not in report-taxonomy.ts's PERIODICITY_BASE_VALUES
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "sometimes", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects weekly cadence with no dayOfWeek", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "weekly", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("dayOfWeek")
  })

  test("rejects weekly cadence with an out-of-range dayOfWeek", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "weekly", dayOfWeek: 7, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects monthly cadence with no dayOfMonth", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "monthly", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("dayOfMonth")
  })

  test("rejects monthly cadence with an out-of-range dayOfMonth", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "monthly", dayOfWeek: null, dayOfMonth: 32, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects custom_range with no startDate/endDate", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "custom_range", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects an empty recipientUserIds", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "daily", dayOfWeek: null, dayOfMonth: null, recipientUserIds: [] })
    expect(result.valid).toBe(false)
  })
})

describe("isScheduleDue", () => {
  test("hourly and daily are always due", () => {
    expect(isScheduleDue({ cadence: "hourly", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "daily", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
  })

  test("immediate and on_demand are never cron-due", () => {
    expect(isScheduleDue({ cadence: "immediate", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
    expect(isScheduleDue({ cadence: "on_demand", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
  })

  test("weekly is due only on the matching UTC weekday", () => {
    // 2026-07-13 is a Monday (day 1).
    expect(isScheduleDue({ cadence: "weekly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "weekly", dayOfWeek: 2, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
  })

  test("biweekly fires on the anchor day AND 3 days later", () => {
    // Anchor Monday (1) -> also fires Thursday (4).
    expect(isScheduleDue({ cadence: "biweekly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true) // Monday
    expect(isScheduleDue({ cadence: "biweekly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-16T09:00:00Z"))).toBe(true) // Thursday
    expect(isScheduleDue({ cadence: "biweekly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-14T09:00:00Z"))).toBe(false) // Tuesday
  })

  test("fortnightly is due only on the matching UTC weekday (same predicate as weekly -- true every-2-weeks skip needs a reference week, a documented limitation)", () => {
    expect(isScheduleDue({ cadence: "fortnightly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
  })

  test("monthly is due only on the matching day of month", () => {
    expect(isScheduleDue({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 13 }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 14 }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
  })

  test("monthly dayOfMonth=31 clamps to the real last day of a shorter month", () => {
    // Feb 2026 has 28 days (2026 is not a leap year).
    expect(isScheduleDue({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 31 }, new Date("2026-02-28T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "monthly", dayOfWeek: null, dayOfMonth: 31 }, new Date("2026-02-27T09:00:00Z"))).toBe(false)
  })

  test("monthly with no dayOfMonth is never due", () => {
    expect(isScheduleDue({ cadence: "monthly", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
  })

  test("quarterly/half_yearly/yearly/biyearly all use the same dayOfMonth predicate as monthly today (documented limitation: no reference-month anchor for true N-month-interval gating)", () => {
    expect(isScheduleDue({ cadence: "quarterly", dayOfWeek: null, dayOfMonth: 13 }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "yearly", dayOfWeek: null, dayOfMonth: 13 }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
  })

  test("year_to_date is due only on Jan 1", () => {
    expect(isScheduleDue({ cadence: "year_to_date", dayOfWeek: null, dayOfMonth: null }, new Date("2026-01-01T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "year_to_date", dayOfWeek: null, dayOfMonth: null }, new Date("2026-01-02T09:00:00Z"))).toBe(false)
  })

  test("custom_range is due only on its endDate, within the range", () => {
    const schedule = { cadence: "custom_range", dayOfWeek: null, dayOfMonth: null, startDate: "2026-08-01", endDate: "2026-08-31" }
    expect(isScheduleDue(schedule, new Date("2026-08-31T09:00:00Z"))).toBe(true)
    expect(isScheduleDue(schedule, new Date("2026-08-15T09:00:00Z"))).toBe(false)
    expect(isScheduleDue(schedule, new Date("2026-09-01T09:00:00Z"))).toBe(false)
  })

  test("custom_range with no startDate/endDate is never due", () => {
    expect(isScheduleDue({ cadence: "custom_range", dayOfWeek: null, dayOfMonth: null }, new Date("2026-08-31T09:00:00Z"))).toBe(false)
  })
})

describe("matchesTimeOfDay", () => {
  test("empty/undefined timesOfDay always matches (unchanged pre-Priority-11 behavior)", () => {
    expect(matchesTimeOfDay(undefined, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(matchesTimeOfDay([], new Date("2026-07-13T09:00:00Z"))).toBe(true)
  })

  test("matches when the current UTC hour is in the list", () => {
    expect(matchesTimeOfDay(["08:00", "20:00"], new Date("2026-07-13T08:15:00Z"))).toBe(true)
    expect(matchesTimeOfDay(["08:00", "20:00"], new Date("2026-07-13T20:00:00Z"))).toBe(true)
  })

  test("does not match an hour not in the list", () => {
    expect(matchesTimeOfDay(["08:00", "20:00"], new Date("2026-07-13T14:00:00Z"))).toBe(false)
  })

  test("daily-thrice example (8AM/2PM/6PM) matches all 3 hours", () => {
    const times = ["08:00", "14:00", "18:00"]
    expect(matchesTimeOfDay(times, new Date("2026-07-13T08:05:00Z"))).toBe(true)
    expect(matchesTimeOfDay(times, new Date("2026-07-13T14:05:00Z"))).toBe(true)
    expect(matchesTimeOfDay(times, new Date("2026-07-13T18:05:00Z"))).toBe(true)
    expect(matchesTimeOfDay(times, new Date("2026-07-13T09:05:00Z"))).toBe(false)
  })
})
