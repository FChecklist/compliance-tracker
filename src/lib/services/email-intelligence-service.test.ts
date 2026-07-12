// Priority 2 item 4 (D21.B4.S1): sanitizeSuggestedWorkItems is the decision
// point that turns raw (untrusted) LLM JSON output into the shape this
// service persists and later promotes into real tasks -- covering it
// directly, same house style as high-impact-action-detector.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { sanitizeSuggestedWorkItems } from "./email-intelligence-service"

describe("sanitizeSuggestedWorkItems", () => {
  test("returns an empty array for non-array input", () => {
    expect(sanitizeSuggestedWorkItems(null)).toEqual([])
    expect(sanitizeSuggestedWorkItems(undefined)).toEqual([])
    expect(sanitizeSuggestedWorkItems("not an array")).toEqual([])
  })

  test("drops entries with no real title", () => {
    const result = sanitizeSuggestedWorkItems([{ title: "" }, { title: "   " }, { notATitle: "x" }])
    expect(result).toEqual([])
  })

  test("defaults an invalid/missing category to follow_up", () => {
    const result = sanitizeSuggestedWorkItems([{ title: "Send the report" }, { title: "Odd one", category: "not_a_real_category" }])
    expect(result).toHaveLength(2)
    expect(result[0]!.category).toBe("follow_up")
    expect(result[1]!.category).toBe("follow_up")
  })

  test("preserves a valid category and normalizes assignee/dueDateHint nullability", () => {
    const result = sanitizeSuggestedWorkItems([
      { title: "Approve the budget", category: "approval_needed", assignee: "  Priya  ", dueDateHint: "  next Friday  " },
      { title: "No assignee given", category: "deadline", assignee: "", dueDateHint: null },
    ])
    expect(result[0]).toEqual({ title: "Approve the budget", category: "approval_needed", assignee: "Priya", dueDateHint: "next Friday" })
    expect(result[1]).toEqual({ title: "No assignee given", category: "deadline", assignee: null, dueDateHint: null })
  })

  test("trims title text", () => {
    const result = sanitizeSuggestedWorkItems([{ title: "  Follow up with vendor  ", category: "commitment" }])
    expect(result[0]!.title).toBe("Follow up with vendor")
  })
})
