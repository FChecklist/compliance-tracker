/// <reference types="bun-types" />
// R67 F-26 -- the Task Master page cursor.
//
// Every case here is a way a paged list silently loses or repeats a row, which
// is the failure mode that makes pagination worse than not paging at all.
import { describe, expect, test } from "bun:test"
import { buildTaskCursor, needsYouRank, nextTaskCursor, parseTaskCursor } from "./task-cursor"

const AT = new Date("2026-09-02T10:15:30.123Z")

describe("needsYouRank -- the leading sort key", () => {
  test("to_do and waiting are what is stuck on the user", () => {
    expect(needsYouRank("to_do")).toBe(1)
    expect(needsYouRank("waiting")).toBe(1)
  })

  test("everything else -- including blocked -- ranks below them in the SORT, which is not the same as the GROUP it renders in", () => {
    // A blocked row is rendered in "Needs you" (M24: it is stuck on a decision
    // only the user can make). The sort key here is about page ORDER, and the
    // grouping the response returns is computed separately from the same rows,
    // so the two cannot disagree about membership.
    expect(needsYouRank("blocked")).toBe(0)
    expect(needsYouRank("in_progress")).toBe(0)
    expect(needsYouRank("done")).toBe(0)
  })

  test("a null or unknown status ranks 0 rather than throwing", () => {
    expect(needsYouRank(null)).toBe(0)
    expect(needsYouRank(undefined)).toBe(0)
    expect(needsYouRank("something-new")).toBe(0)
  })
})

describe("buildTaskCursor / parseTaskCursor", () => {
  test("round-trips all three parts of the composite sort key", () => {
    const cursor = buildTaskCursor({ status: "to_do", createdAt: AT, id: "task-1" })
    expect(parseTaskCursor(cursor)).toEqual({ rank: 1, createdAt: AT, id: "task-1" })
  })

  test("carries the needs-you rank, without which page 2 would drop every needs-you row older than the newest done row", () => {
    expect(buildTaskCursor({ status: "to_do", createdAt: AT, id: "t" }).startsWith("1,")).toBe(true)
    expect(buildTaskCursor({ status: "done", createdAt: AT, id: "t" }).startsWith("0,")).toBe(true)
  })

  test("keeps the timestamp to the millisecond -- truncating to the second would repeat or skip rows minted in the same second", () => {
    const cursor = buildTaskCursor({ status: "done", createdAt: AT, id: "t" })
    expect(cursor).toContain("2026-09-02T10:15:30.123Z")
  })

  test("accepts a string createdAt, which is what a JSON round trip leaves behind", () => {
    expect(parseTaskCursor(buildTaskCursor({ status: "done", createdAt: AT.toISOString(), id: "t" }))?.createdAt).toEqual(AT)
  })

  test("an id containing a comma survives -- only the first two commas are separators", () => {
    const cursor = buildTaskCursor({ status: "done", createdAt: AT, id: "weird,id" })
    expect(parseTaskCursor(cursor)?.id).toBe("weird,id")
  })

  test("a malformed cursor is null, so a stale bookmark starts from the top instead of 500ing a read", () => {
    expect(parseTaskCursor(null)).toBeNull()
    expect(parseTaskCursor("")).toBeNull()
    expect(parseTaskCursor("garbage")).toBeNull()
    expect(parseTaskCursor("2,2026-09-02T10:15:30.123Z,task-1")).toBeNull() // rank out of range
    expect(parseTaskCursor("1,not-a-date,task-1")).toBeNull()
    expect(parseTaskCursor("1,2026-09-02T10:15:30.123Z,")).toBeNull() // no id
    expect(parseTaskCursor(",2026-09-02T10:15:30.123Z,task-1")).toBeNull() // no rank
  })
})

describe("nextTaskCursor -- only when there really is a next page", () => {
  test("a full page hands back the position after its last row", () => {
    const rows = [
      { status: "to_do", createdAt: AT, id: "a" },
      { status: "done", createdAt: AT, id: "b" },
    ]
    expect(nextTaskCursor(rows, 2)).toBe(buildTaskCursor(rows[1]))
  })

  test("a SHORT page is the end of the list -- no cursor, so no 'Show 20 more' control that loads nothing", () => {
    expect(nextTaskCursor([{ status: "to_do", createdAt: AT, id: "a" }], 20)).toBeNull()
  })

  test("an empty page is the end of the list", () => {
    expect(nextTaskCursor([], 20)).toBeNull()
  })
})
