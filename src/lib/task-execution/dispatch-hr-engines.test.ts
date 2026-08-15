/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchHrEngines } from "./dispatch-hr-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchHrEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchHrEngines("eps_calculator", {})).toBe(NOT_HANDLED)
  })

  test("attendance_calculator dispatches a pure percentage", async () => {
    expect(await dispatchHrEngines("attendance_calculator", { presentDays: 20, totalWorkingDays: 25 })).toEqual({ attendancePercent: 80 })
  })

  test("shift_planner rejects when either employeeIds or shifts is not an array", async () => {
    expect(dispatchHrEngines("shift_planner", { employeeIds: [], shifts: "nope" })).rejects.toThrow("employeeIds and shifts must both be arrays")
  })

  test("roster_engine rejects when any of the three array inputs is missing", async () => {
    expect(dispatchHrEngines("roster_engine", { employeeIds: [], dates: [], rotationPattern: "nope" }))
      .rejects.toThrow("employeeIds, dates, and rotationPattern must all be arrays")
  })

  test("performance_score_calculator rejects a non-array ratings", async () => {
    expect(dispatchHrEngines("performance_score_calculator", { ratings: "nope" })).rejects.toThrow("ratings must be an array")
  })

  test("performance_score_calculator accepts a real ratings array", async () => {
    const result = await dispatchHrEngines("performance_score_calculator", { ratings: [{ competency: "x", score: 4, weight: 1 }] })
    expect(result).toBeTruthy()
  })
})
