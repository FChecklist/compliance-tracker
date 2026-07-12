/// <reference types="bun-types" />
// GAP-CONTINUOUS-REPRIORITIZATION (Tree 1 D22.B2.S1): tests
// computeReprioritizedPriority() -- the pure recalculation core
// reprioritizeTasks() delegates to -- directly. The DB-touching
// reprioritizeTasks() itself is deliberately left untested here, matching
// this repo's established pattern of not exercising a live DB from a
// .test.ts file (see task-service.test.ts's own note on this, which this
// file's sibling isTaskOverdue()/checkTaskOverdue() split already follows).
import { describe, expect, test } from "bun:test"
import { computeReprioritizedPriority } from "./task-reprioritization-service"

const NOW = new Date("2026-07-12T12:00:00Z")

describe("computeReprioritizedPriority -- deadline-driven escalation only", () => {
  test("no due date: no signal, no change", () => {
    expect(computeReprioritizedPriority({ status: "pending", dueDate: null, priority: 0 }, NOW)).toBeNull()
  })

  test("due date far in the future (beyond 72h): no signal, no change", () => {
    const dueDate = new Date("2026-08-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toBeNull()
  })

  test("already overdue: escalates to Urgent (3)", () => {
    const dueDate = new Date("2026-07-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toEqual({
      priority: 3,
      reason: "overdue",
    })
  })

  test("overdue in_progress task also escalates", () => {
    const dueDate = new Date("2026-07-10T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "in_progress", dueDate, priority: 1 }, NOW)).toEqual({
      priority: 3,
      reason: "overdue",
    })
  })

  test("due within 24h (not yet overdue): escalates to High (2)", () => {
    const dueDate = new Date("2026-07-13T00:00:00Z") // 12h out
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toEqual({
      priority: 2,
      reason: "due_within_24h",
    })
  })

  test("due within 72h but beyond 24h: escalates to Normal (1)", () => {
    const dueDate = new Date("2026-07-14T18:00:00Z") // 54h out
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toEqual({
      priority: 1,
      reason: "due_within_72h",
    })
  })

  test("exactly at the 24h boundary counts as due_within_72h, not due_within_24h", () => {
    const dueDate = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toEqual({
      priority: 1,
      reason: "due_within_72h",
    })
  })

  test("exactly at the 72h boundary carries no signal", () => {
    const dueDate = new Date(NOW.getTime() + 72 * 60 * 60 * 1000)
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 0 }, NOW)).toBeNull()
  })

  test("completed tasks are never reprioritized, even overdue", () => {
    const dueDate = new Date("2026-07-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "completed", dueDate, priority: 0 }, NOW)).toBeNull()
  })

  test("cancelled tasks are never reprioritized, even overdue", () => {
    const dueDate = new Date("2026-07-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "cancelled", dueDate, priority: 0 }, NOW)).toBeNull()
  })

  test("failed tasks are still eligible (not a terminal status here)", () => {
    const dueDate = new Date("2026-07-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "failed", dueDate, priority: 0 }, NOW)).toEqual({
      priority: 3,
      reason: "overdue",
    })
  })

  test("never downgrades: already-Urgent overdue task produces no write", () => {
    const dueDate = new Date("2026-07-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 3 }, NOW)).toBeNull()
  })

  test("never downgrades: a manually-set High priority with a distant due date is left alone", () => {
    const dueDate = new Date("2026-08-01T00:00:00Z")
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 2 }, NOW)).toBeNull()
  })

  test("never downgrades: priority already at or above the computed floor is a no-op", () => {
    const dueDate = new Date("2026-07-13T00:00:00Z") // due_within_24h -> floor 2
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 3 }, NOW)).toBeNull()
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 2 }, NOW)).toBeNull()
  })

  test("does escalate when current priority is strictly below the floor", () => {
    const dueDate = new Date("2026-07-13T00:00:00Z") // due_within_24h -> floor 2
    expect(computeReprioritizedPriority({ status: "pending", dueDate, priority: 1 }, NOW)).toEqual({
      priority: 2,
      reason: "due_within_24h",
    })
  })
})
