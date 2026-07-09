/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { formatShortReply, renderShortReply, suggestResponseForTaskStatus } from "./response-engine"

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
    const labels = ["yes", "no", "ok", "pending", "completed", "need_clarity", "require_input", "wrong_data", "incomplete_instructions"] as const
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

  test("maps failed status to Wrong Data", () => {
    expect(suggestResponseForTaskStatus("failed").label).toBe("wrong_data")
  })

  test("maps cancelled status to Incomplete Instructions", () => {
    expect(suggestResponseForTaskStatus("cancelled").label).toBe("incomplete_instructions")
  })

  test("falls back to Pending with the raw status as detail for an unknown status", () => {
    const reply = suggestResponseForTaskStatus("some_future_status")
    expect(reply.label).toBe("pending")
    expect(reply.detail).toContain("some_future_status")
  })
})
