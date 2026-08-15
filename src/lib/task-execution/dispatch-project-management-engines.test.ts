/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchProjectManagementEngines } from "./dispatch-project-management-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchProjectManagementEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchProjectManagementEngines("marketing_roi_calculator", {})).toBe(NOT_HANDLED)
  })

  test("critical_path_engine rejects a non-array tasks", async () => {
    expect(dispatchProjectManagementEngines("critical_path_engine", { tasks: "nope" })).rejects.toThrow("tasks must be an array")
  })

  test("resource_allocation_engine rejects a non-array tasks", async () => {
    expect(dispatchProjectManagementEngines("resource_allocation_engine", { tasks: "nope", availableCapacity: 10 })).rejects.toThrow("tasks must be an array")
  })

  test("burndown_calculator rejects a non-array completedPointsByDay", async () => {
    expect(dispatchProjectManagementEngines("burndown_calculator", { totalStoryPoints: 10, sprintDays: 5, completedPointsByDay: "nope" }))
      .rejects.toThrow("completedPointsByDay must be an array")
  })

  test("cost_variance_engine and schedule_variance_engine dispatch to distinct pure formulas", async () => {
    expect(await dispatchProjectManagementEngines("cost_variance_engine", { earnedValue: 100, actualCost: 80 })).toEqual({ costVariance: 20 })
    expect(await dispatchProjectManagementEngines("schedule_variance_engine", { earnedValue: 100, plannedValue: 120 })).toEqual({ scheduleVariance: -20 })
  })
})
