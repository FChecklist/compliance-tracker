/// <reference types="bun-types" />
// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Work
// Detection"). Tests the pure part of task-dedup-service.ts
// (buildTaskDedupContent) -- findSimilarActiveTasks()/
// scanForDuplicateTasks()/indexTaskForDedup() themselves touch the DB and
// are deliberately left untested here, matching this repo's established
// pattern (see capability-registry-service.test.ts's own identical note).
import { describe, expect, test } from "bun:test"
import { buildTaskDedupContent } from "./task-dedup-service"

describe("buildTaskDedupContent", () => {
  test("joins title and description with a separator", () => {
    expect(buildTaskDedupContent("File GSTR-3B for June", "Monthly GST return for the June period"))
      .toBe("File GSTR-3B for June | Monthly GST return for the June period")
  })

  test("omits a null description rather than emitting a trailing separator", () => {
    expect(buildTaskDedupContent("File GSTR-3B for June", null)).toBe("File GSTR-3B for June")
  })

  test("omits an empty-string description", () => {
    expect(buildTaskDedupContent("File GSTR-3B for June", "")).toBe("File GSTR-3B for June")
  })
})
