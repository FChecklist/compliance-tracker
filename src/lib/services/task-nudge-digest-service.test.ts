/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { groupTasksForNudge, summarizeNudgeGroup, type NudgeTaskRow } from "./task-nudge-digest-service"

const NOW = new Date("2026-07-12T00:00:00Z")

function taskRow(overrides: Partial<NudgeTaskRow> & { id: string; userId: string; dueDate: Date }): NudgeTaskRow {
  return { title: `Task ${overrides.id}`, status: "pending", ...overrides }
}

describe("groupTasksForNudge", () => {
  test("empty input produces no groups", () => {
    expect(groupTasksForNudge([], NOW)).toEqual([])
  })

  test("a task due in the past goes in the overdue bucket", () => {
    const rows = [taskRow({ id: "t1", userId: "u1", dueDate: new Date("2026-07-10T00:00:00Z") })]
    const groups = groupTasksForNudge(rows, NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].overdue.map((t) => t.id)).toEqual(["t1"])
    expect(groups[0].dueSoon).toEqual([])
  })

  test("a task due exactly at 'now' is NOT overdue (strict less-than)", () => {
    const rows = [taskRow({ id: "t1", userId: "u1", dueDate: NOW })]
    const groups = groupTasksForNudge(rows, NOW)
    expect(groups[0].overdue).toEqual([])
  })

  test("a task due within the default 3-day window is due-soon, not overdue", () => {
    const rows = [taskRow({ id: "t1", userId: "u1", dueDate: new Date("2026-07-14T00:00:00Z") })]
    const groups = groupTasksForNudge(rows, NOW)
    expect(groups[0].dueSoon.map((t) => t.id)).toEqual(["t1"])
    expect(groups[0].overdue).toEqual([])
  })

  test("a task due well beyond the window is in neither bucket", () => {
    const rows = [taskRow({ id: "t1", userId: "u1", dueDate: new Date("2026-08-01T00:00:00Z") })]
    const groups = groupTasksForNudge(rows, NOW)
    expect(groups[0].overdue).toEqual([])
    expect(groups[0].dueSoon).toEqual([])
  })

  test("groups multiple users' tasks independently", () => {
    const rows = [
      taskRow({ id: "t1", userId: "u1", dueDate: new Date("2026-07-01T00:00:00Z") }), // overdue
      taskRow({ id: "t2", userId: "u2", dueDate: new Date("2026-07-13T00:00:00Z") }), // due soon
    ]
    const groups = groupTasksForNudge(rows, NOW)
    expect(groups).toHaveLength(2)
    const byUser = new Map(groups.map((g) => [g.userId, g]))
    expect(byUser.get("u1")!.overdue.map((t) => t.id)).toEqual(["t1"])
    expect(byUser.get("u2")!.dueSoon.map((t) => t.id)).toEqual(["t2"])
  })

  test("respects a custom dueSoonWindowDays", () => {
    const rows = [taskRow({ id: "t1", userId: "u1", dueDate: new Date("2026-07-20T00:00:00Z") })]
    expect(groupTasksForNudge(rows, NOW, 3)[0].dueSoon).toEqual([])
    expect(groupTasksForNudge(rows, NOW, 10)[0].dueSoon.map((t) => t.id)).toEqual(["t1"])
  })
})

describe("summarizeNudgeGroup", () => {
  test("a user with nothing overdue/due-soon gets an 'ok, nothing due' reply", () => {
    const reply = summarizeNudgeGroup({ userId: "u1", overdue: [], dueSoon: [] })
    expect(reply.label).toBe("ok")
  })

  test("overdue takes priority over due-soon when a user has both", () => {
    const reply = summarizeNudgeGroup({
      userId: "u1",
      overdue: [taskRow({ id: "t1", userId: "u1", dueDate: NOW })],
      dueSoon: [taskRow({ id: "t2", userId: "u1", dueDate: NOW })],
    })
    expect(reply.label).toBe("pending")
    expect(reply.detail).toContain("overdue")
  })

  test("a single overdue task names it by title", () => {
    const reply = summarizeNudgeGroup({
      userId: "u1",
      overdue: [taskRow({ id: "t1", userId: "u1", dueDate: NOW, title: "File GST return" })],
      dueSoon: [],
    })
    expect(reply.detail).toBe("File GST return overdue")
  })

  test("multiple overdue tasks are summarized as a count, not a long list (stays within the 4-word-plus-specifics discipline)", () => {
    const reply = summarizeNudgeGroup({
      userId: "u1",
      overdue: [
        taskRow({ id: "t1", userId: "u1", dueDate: NOW }),
        taskRow({ id: "t2", userId: "u1", dueDate: NOW }),
        taskRow({ id: "t3", userId: "u1", dueDate: NOW }),
      ],
      dueSoon: [],
    })
    expect(reply.detail).toBe("3 tasks overdue")
  })
})
