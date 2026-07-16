// VERIDIAN Review Framework remediation, Wave B: tests the pure attendance
// state-model/calculation functions (isWeekendDate / enumerateDates /
// datesInMonth / computeHoursWorked / computeMonthlySummary) directly,
// matching this repo's established pattern of not exercising
// withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  isWeekendDate, enumerateDates, datesInMonth, computeHoursWorked, computeMonthlySummary, ServiceError,
} from "./hr-attendance-service"

describe("isWeekendDate", () => {
  test("Saturday and Sunday are weekends", () => {
    expect(isWeekendDate("2026-07-18")).toBe(true) // Saturday
    expect(isWeekendDate("2026-07-19")).toBe(true) // Sunday
  })
  test("weekdays are not weekends", () => {
    expect(isWeekendDate("2026-07-17")).toBe(false) // Friday
    expect(isWeekendDate("2026-07-20")).toBe(false) // Monday
  })
})

describe("enumerateDates", () => {
  test("inclusive of both endpoints", () => {
    expect(enumerateDates("2026-07-01", "2026-07-03")).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"])
  })
  test("single-day range returns exactly one date", () => {
    expect(enumerateDates("2026-07-01", "2026-07-01")).toEqual(["2026-07-01"])
  })
  test("spans a month boundary correctly", () => {
    expect(enumerateDates("2026-07-30", "2026-08-02")).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"])
  })
  test("rejects an invalid date", () => {
    expect(() => enumerateDates("not-a-date", "2026-07-03")).toThrow(ServiceError)
  })
})

describe("datesInMonth", () => {
  test("February in a leap year has 29 days", () => {
    expect(datesInMonth(2, 2028).length).toBe(29)
  })
  test("February in a non-leap year has 28 days", () => {
    expect(datesInMonth(2, 2026).length).toBe(28)
  })
  test("rejects month outside 1-12", () => {
    expect(() => datesInMonth(13, 2026)).toThrow(ServiceError)
    expect(() => datesInMonth(0, 2026)).toThrow(ServiceError)
  })
})

describe("computeHoursWorked", () => {
  test("computes fractional hours correctly", () => {
    const checkIn = new Date("2026-07-17T09:00:00Z")
    const checkOut = new Date("2026-07-17T17:30:00Z")
    expect(computeHoursWorked(checkIn, checkOut)).toBeCloseTo(8.5)
  })
  test("rejects checkOut before or equal to checkIn", () => {
    const t = new Date("2026-07-17T09:00:00Z")
    expect(() => computeHoursWorked(t, t)).toThrow(ServiceError)
    expect(() => computeHoursWorked(t, new Date("2026-07-17T08:00:00Z"))).toThrow(ServiceError)
  })
})

describe("computeMonthlySummary", () => {
  // July 2026: 31 days. Fridays->Thursdays: 2026-07-01 is a Wednesday.
  // Weekends in July 2026: 4,5,11,12,18,19,25,26 -> 8 weekend days.
  test("a fully-marked month with no holidays: workingDays excludes only weekends", () => {
    const workingDates = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`)
      .filter((d) => !isWeekendDate(d))
    const records = workingDates.map((date) => ({ date, status: "present" as const }))
    const summary = computeMonthlySummary(7, 2026, records, [])
    expect(summary.totalDaysInMonth).toBe(31)
    expect(summary.weekendDays).toBe(8)
    expect(summary.holidayDays).toBe(0)
    expect(summary.workingDays).toBe(23)
    expect(summary.present).toBe(23)
    expect(summary.unmarked).toBe(0)
    expect(summary.attendancePercent).toBe(100)
  })

  test("holidays reduce the working-day denominator and don't get counted as unmarked", () => {
    // 2026-07-17 is a Friday (a working day) -- declare it a holiday.
    const summary = computeMonthlySummary(7, 2026, [], ["2026-07-17"])
    expect(summary.holidayDays).toBe(1)
    expect(summary.workingDays).toBe(31 - 8 - 1) // total - weekends - the one holiday
    expect(summary.unmarked).toBe(31 - 8 - 1) // every other working day has no record -> unmarked
  })

  test("a holiday that falls on a weekend is not double-subtracted", () => {
    // 2026-07-18 is a Saturday.
    const summary = computeMonthlySummary(7, 2026, [], ["2026-07-18"])
    expect(summary.weekendDays).toBe(8)
    expect(summary.holidayDays).toBe(0) // the weekend branch runs first and `continue`s, so the holiday set is never consulted for this date
    expect(summary.workingDays).toBe(31 - 8)
  })

  test("half days count as 0.5 toward both payableDays and attendancePercent", () => {
    const summary = computeMonthlySummary(7, 2026, [{ date: "2026-07-17", status: "half_day" }], [])
    expect(summary.halfDay).toBe(1)
    const expectedPercent = Math.round((0.5 / summary.workingDays) * 10000) / 100
    expect(summary.attendancePercent).toBeCloseTo(expectedPercent)
  })

  test("on_leave days count toward payableDays but not attendancePercent", () => {
    const summary = computeMonthlySummary(7, 2026, [{ date: "2026-07-17", status: "on_leave" }], [])
    expect(summary.onLeave).toBe(1)
    expect(summary.payableDays).toBe(summary.weekendDays + summary.holidayDays + 1) // present=0, halfDay=0, onLeave=1
    expect(summary.attendancePercent).toBe(0) // no present/half-day credit for a leave day
  })

  test("absent days reduce attendancePercent but still count as a working day", () => {
    const summary = computeMonthlySummary(7, 2026, [{ date: "2026-07-17", status: "absent" }], [])
    expect(summary.absent).toBe(1)
    expect(summary.workingDays).toBe(23)
    expect(summary.attendancePercent).toBe(0)
  })

  test("partial month (mid-month join): only marked days count, rest of working days are unmarked", () => {
    // Simulate an employee who only has records for the first 5 working days.
    const workingDates = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`)
      .filter((d) => !isWeekendDate(d))
      .slice(0, 5)
    const records = workingDates.map((date) => ({ date, status: "present" as const }))
    const summary = computeMonthlySummary(7, 2026, records, [])
    expect(summary.present).toBe(5)
    expect(summary.unmarked).toBe(summary.workingDays - 5)
  })

  test("a duplicate date in the input (shouldn't happen given the DB's UNIQUE constraint, but stay defensive) counts once, using the last value", () => {
    const summary = computeMonthlySummary(7, 2026, [
      { date: "2026-07-17", status: "absent" },
      { date: "2026-07-17", status: "present" },
    ], [])
    expect(summary.present).toBe(1)
    expect(summary.absent).toBe(0)
  })

  test("a month that is entirely weekends/holidays has workingDays=0 and attendancePercent defaults to 100 (nothing to fail)", () => {
    const allDates = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`)
    const nonWeekendDates = allDates.filter((d) => !isWeekendDate(d))
    const summary = computeMonthlySummary(7, 2026, [], nonWeekendDates)
    expect(summary.workingDays).toBe(0)
    expect(summary.attendancePercent).toBe(100)
  })
})
