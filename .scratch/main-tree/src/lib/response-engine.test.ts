/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  formatShortReply, renderShortReply, suggestResponseForTaskStatus,
  formatTaskCompletionSummary, formatComplianceFilingSummary, formatComplianceStatusDigest,
} from "./response-engine"

describe("formatShortReply / renderShortReply", () => {
  test("renders a label with no detail as just the label text", () => {
    expect(renderShortReply(formatShortReply("ok"))).toBe("OK")
  })

  test("renders a label with detail as 'Label — detail'", () => {
    expect(renderShortReply(formatShortReply("pending", "GST filing"))).toBe("Pending — GST filing")
  })

  test("trims whitespace-only detail down to no detail", () => {
    expect(renderShortReply(formatShortReply("completed", "   "))).toBe("Completed")
  })

  test("covers every label in the predefined vocabulary", () => {
    const labels = ["yes", "no", "ok", "pending", "completed", "failed", "need_clarity", "require_input", "wrong_data", "incomplete_instructions"] as const
    for (const label of labels) {
      const reply = formatShortReply(label)
      expect(reply.text.length).toBeGreaterThan(0)
      // Max ~4 words per the doc's own rule.
      expect(reply.text.split(" ").length).toBeLessThanOrEqual(4)
    }
  })
})

describe("suggestResponseForTaskStatus", () => {
  test("maps completed status to the Completed label", () => {
    const reply = suggestResponseForTaskStatus("completed", "GST filing")
    expect(reply.label).toBe("completed")
    expect(renderShortReply(reply)).toBe("Completed — GST filing")
  })

  test("maps pending status to the Pending label", () => {
    expect(suggestResponseForTaskStatus("pending").label).toBe("pending")
  })

  test("maps in_progress status to Pending with an in-progress detail", () => {
    const reply = suggestResponseForTaskStatus("in_progress")
    expect(reply.label).toBe("pending")
    expect(reply.detail).toContain("in progress")
  })

  // Wave 154 audit fix (AUDIT_wave154_claude_items.md): failed/cancelled
  // used to borrow wrong_data/incomplete_instructions, both flagged as
  // semantic stretches (a failure isn't necessarily bad input data; a
  // cancellation is often the user's own deliberate choice). Failed now
  // gets its own exact label; cancelled maps to an acknowledging "OK".
  test("maps failed status to the Failed label", () => {
    expect(suggestResponseForTaskStatus("failed").label).toBe("failed")
  })

  test("maps cancelled status to OK (acknowledgment, not blame)", () => {
    const reply = suggestResponseForTaskStatus("cancelled")
    expect(reply.label).toBe("ok")
    expect(reply.detail).toContain("cancelled")
  })

  test("falls back to Pending with the raw status as detail for an unknown status", () => {
    const reply = suggestResponseForTaskStatus("some_future_status")
    expect(reply.label).toBe("pending")
    expect(reply.detail).toContain("some_future_status")
  })
})

// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, dispatch 4,
// item E5): widens the same predefined-template-plus-real-data mechanism to
// STATUS UPDATES and REPORT SUMMARIES. Real-shaped sample data throughout
// (task counts, compliance_items-style status/dueDate), per this dispatch's
// own "test thoroughly with real-shaped sample data" instruction.
describe("formatTaskCompletionSummary -- 'X of Y tasks completed <period>'", () => {
  test("formats a real partial-completion count", () => {
    expect(formatTaskCompletionSummary({ completed: 3, total: 7, periodLabel: "this week" })).toBe(
      "3 of 7 tasks completed this week"
    )
  })

  test("formats a full-completion count", () => {
    expect(formatTaskCompletionSummary({ completed: 5, total: 5, periodLabel: "this month" })).toBe(
      "5 of 5 tasks completed this month"
    )
  })

  test("formats a zero-completion count (not the same as zero tasks)", () => {
    expect(formatTaskCompletionSummary({ completed: 0, total: 4, periodLabel: "today" })).toBe(
      "0 of 4 tasks completed today"
    )
  })

  test("total of 0 gets an honest 'No tasks' phrasing, not '0 of 0 tasks completed'", () => {
    expect(formatTaskCompletionSummary({ completed: 0, total: 0, periodLabel: "this week" })).toBe("No tasks this week")
  })

  test("negative total (defensive) is treated the same as zero", () => {
    expect(formatTaskCompletionSummary({ completed: 0, total: -1, periodLabel: "this week" })).toBe("No tasks this week")
  })
})

describe("formatComplianceFilingSummary -- 'TYPE filing status: Status, due DATE'", () => {
  test("formats a real GST filing row with a Date object due date", () => {
    expect(
      formatComplianceFilingSummary({ complianceType: "GST", status: "pending", dueDate: new Date("2026-07-15T00:00:00.000Z") })
    ).toBe("GST filing status: Pending, due 15 Jul 2026")
  })

  test("formats a real TDS filing row with a string due date", () => {
    expect(
      formatComplianceFilingSummary({ complianceType: "TDS", status: "completed", dueDate: "2026-01-07T00:00:00.000Z" })
    ).toBe("TDS filing status: Completed, due 7 Jan 2026")
  })

  test("maps every real complianceStatusEnum value to its display label", () => {
    const cases: [string, string][] = [
      ["pending", "Pending"], ["in_progress", "In Progress"], ["completed", "Completed"],
      ["overdue", "Overdue"], ["not_applicable", "Not Applicable"], ["draft", "Draft"],
    ]
    for (const [status, label] of cases) {
      expect(formatComplianceFilingSummary({ complianceType: "GST", status, dueDate: null })).toBe(
        `GST filing status: ${label}, due no due date set`
      )
    }
  })

  test("falls back to the raw status string for an unrecognized status (forward-compatible, doesn't throw)", () => {
    expect(formatComplianceFilingSummary({ complianceType: "GST", status: "some_future_status", dueDate: null })).toBe(
      "GST filing status: some_future_status, due no due date set"
    )
  })

  test("null dueDate reads as 'no due date set'", () => {
    expect(formatComplianceFilingSummary({ complianceType: "MCA", status: "draft", dueDate: null })).toBe(
      "MCA filing status: Draft, due no due date set"
    )
  })

  test("an unparseable date string reads as 'an unknown date' rather than 'Invalid Date' or throwing", () => {
    expect(formatComplianceFilingSummary({ complianceType: "GST", status: "pending", dueDate: "not-a-date" })).toBe(
      "GST filing status: Pending, due an unknown date"
    )
  })
})

describe("formatComplianceStatusDigest -- 'X of Y TYPE filings completed <period>'", () => {
  test("aggregates a real mixed-status compliance_items array", () => {
    const items = [{ status: "completed" }, { status: "completed" }, { status: "pending" }, { status: "overdue" }]
    expect(formatComplianceStatusDigest("GST", items, "this month")).toBe("2 of 4 GST filings completed this month")
  })

  test("all-completed array", () => {
    const items = [{ status: "completed" }, { status: "completed" }]
    expect(formatComplianceStatusDigest("PF", items, "this quarter")).toBe("2 of 2 PF filings completed this quarter")
  })

  test("none-completed array", () => {
    const items = [{ status: "pending" }, { status: "draft" }]
    expect(formatComplianceStatusDigest("TDS", items, "this month")).toBe("0 of 2 TDS filings completed this month")
  })

  test("empty array gets an honest 'No filings' phrasing, not '0 of 0 filings completed'", () => {
    expect(formatComplianceStatusDigest("GST", [], "this month")).toBe("No GST filings this month")
  })

  test("only counts the exact 'completed' status value, not 'in_progress' or anything else", () => {
    const items = [{ status: "in_progress" }, { status: "completed" }]
    expect(formatComplianceStatusDigest("ROC", items, "this year")).toBe("1 of 2 ROC filings completed this year")
  })
})
