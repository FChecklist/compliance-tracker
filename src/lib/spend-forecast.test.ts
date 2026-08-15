/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { daysInMonthUtc, startOfMonthUtc, daysElapsedInMonthUtc, computeLinearForecast, buildSpendForecast } from "./spend-forecast"

describe("daysInMonthUtc", () => {
  test("30-day month", () => {
    expect(daysInMonthUtc(new Date("2026-04-15T00:00:00Z"))).toBe(30)
  })
  test("31-day month", () => {
    expect(daysInMonthUtc(new Date("2026-07-15T00:00:00Z"))).toBe(31)
  })
  test("leap-year February", () => {
    expect(daysInMonthUtc(new Date("2028-02-10T00:00:00Z"))).toBe(29)
  })
  test("non-leap-year February", () => {
    expect(daysInMonthUtc(new Date("2026-02-10T00:00:00Z"))).toBe(28)
  })
})

describe("startOfMonthUtc", () => {
  test("truncates to the 1st of the month at UTC midnight", () => {
    expect(startOfMonthUtc(new Date("2026-07-18T14:32:00Z")).toISOString()).toBe("2026-07-01T00:00:00.000Z")
  })
})

describe("daysElapsedInMonthUtc", () => {
  test("mid-month returns a fractional day count", () => {
    const elapsed = daysElapsedInMonthUtc(new Date("2026-07-18T12:00:00Z"))
    expect(elapsed).toBeCloseTo(17.5, 5)
  })
  test("the 1st of the month floors to 1, not 0 -- avoids a same-day divide-by-zero", () => {
    const elapsed = daysElapsedInMonthUtc(new Date("2026-07-01T00:00:01Z"))
    expect(elapsed).toBe(1)
  })
})

describe("computeLinearForecast", () => {
  test("zero spend so far forecasts to zero, not NaN", () => {
    expect(computeLinearForecast(0, 10, 30)).toBe(0)
  })
  test("halfway through the month at $50 spent projects to $100 for a 30-day month", () => {
    expect(computeLinearForecast(50, 15, 30)).toBeCloseTo(100, 5)
  })
  test("daysElapsed <= 0 returns 0 rather than dividing by zero", () => {
    expect(computeLinearForecast(20, 0, 30)).toBe(0)
  })
})

describe("buildSpendForecast", () => {
  test("assembles a consistent forecast object from a fixed 'now'", () => {
    const now = new Date("2026-07-11T00:00:00Z") // day 10 of a 31-day month
    const forecast = buildSpendForecast(100, now)
    expect(forecast.daysInMonth).toBe(31)
    expect(forecast.daysElapsed).toBeCloseTo(10, 5)
    expect(forecast.actualSpendToDateUsd).toBe(100)
    expect(forecast.forecastedMonthEndSpendUsd).toBeCloseTo(310, 5)
    expect(forecast.periodStart).toBe("2026-07-01T00:00:00.000Z")
  })
})
