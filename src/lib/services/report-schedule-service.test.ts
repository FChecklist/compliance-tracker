/// <reference types="bun-types" />
// Owner directive 2026-07-13: tests the pure validation/decision functions
// -- createReportSchedule()/runDueReportSchedules() themselves touch the
// DB and are deliberately left untested here, matching this repo's
// established pattern (see delegation-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { validateReportScheduleInput, isScheduleDue } from "./report-schedule-service"

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

  test("rejects an empty reportId", () => {
    const result = validateReportScheduleInput({ reportId: "  ", cadence: "daily", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
    expect(result.valid).toBe(false)
  })

  test("rejects an invalid cadence", () => {
    // @ts-expect-error deliberately invalid for the test
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "yearly", dayOfWeek: null, dayOfMonth: null, recipientUserIds: ["u1"] })
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

  test("rejects an empty recipientUserIds", () => {
    const result = validateReportScheduleInput({ reportId: "r1", cadence: "daily", dayOfWeek: null, dayOfMonth: null, recipientUserIds: [] })
    expect(result.valid).toBe(false)
  })
})

describe("isScheduleDue", () => {
  test("daily is always due", () => {
    expect(isScheduleDue({ cadence: "daily", dayOfWeek: null, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
  })

  test("weekly is due only on the matching UTC weekday", () => {
    // 2026-07-13 is a Monday (day 1).
    expect(isScheduleDue({ cadence: "weekly", dayOfWeek: 1, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(true)
    expect(isScheduleDue({ cadence: "weekly", dayOfWeek: 2, dayOfMonth: null }, new Date("2026-07-13T09:00:00Z"))).toBe(false)
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
})
