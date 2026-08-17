/// <reference types="bun-types" />
// Proves generateMeetingMinutesPdf produces a real, non-empty binary PDF --
// the task's own success criterion for PDF export. Pure function, no DB/
// tenant-context mocking needed.
import { describe, expect, test } from "bun:test"
import { generateMeetingMinutesPdf } from "./meeting-minutes-pdf"

describe("generateMeetingMinutesPdf", () => {
  test("produces a real, non-empty PDF buffer with a valid %PDF header", () => {
    const buffer = generateMeetingMinutesPdf({
      systemId: "MOM-2026-1234",
      title: "Site Kickoff Meeting",
      meetingType: "team",
      scheduledAt: "2026-07-28T10:00:00.000Z",
      status: "draft",
      attendees: ["Alice", "Bob"],
      agenda: ["Review schedule", "Discuss RFIs"],
      minutes: "We discussed the schedule and agreed on next steps.",
      aiSummary: "Team aligned on schedule; RFIs to be closed by Friday.",
      aiKeyDecisions: ["Approved revised schedule"],
      aiSuggestedActionItems: [{ title: "Close RFI-12", assignee: "Alice", dueDateHint: "Friday" }],
    })

    expect(buffer.byteLength).toBeGreaterThan(1000)
    const header = Buffer.from(buffer.slice(0, 5)).toString("ascii")
    expect(header).toBe("%PDF-")
  })

  test("still produces a valid, non-empty PDF for a meeting with no minutes yet", () => {
    const buffer = generateMeetingMinutesPdf({
      systemId: null,
      title: "Empty Meeting",
      meetingType: "team",
      scheduledAt: new Date("2026-07-28T10:00:00.000Z"),
      status: "draft",
      attendees: [],
      agenda: [],
      minutes: null,
      aiSummary: null,
      aiKeyDecisions: [],
      aiSuggestedActionItems: [],
    })

    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })
})
