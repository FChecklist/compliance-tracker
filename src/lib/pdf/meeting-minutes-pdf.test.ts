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

  // R67 lane D22 (item D-58): a MoM has to name its project, list the actions
  // that were really agreed (not only the AI's guesses), and be paginated.
  test("renders the project name, the agreed action items and page numbers", () => {
    const buffer = generateMeetingMinutesPdf({
      systemId: "MOM-2026-0007",
      projectName: "Skyline Tower A",
      title: "Weekly Site Coordination",
      meetingType: "team",
      scheduledAt: "2026-08-28T04:30:00.000Z",
      status: "published",
      attendees: ["Arjun Mehta", "Priya Nair"],
      agenda: ["Progress vs programme", "Material shortfalls"],
      // Long enough to force a second page, so "Page 1 of 2" is really exercised.
      minutes: Array.from({ length: 220 }, (_, i) => `Line ${i + 1}: the crew reported progress on the podium slab.`).join(" "),
      actionItems: [
        { title: "Close RFI-12", owner: "Arjun Mehta", dueDate: "2026-09-04", status: "in_progress" },
        { title: "Order rebar", owner: null, dueDate: null, status: "in_progress" },
      ],
      aiSummary: null,
      aiKeyDecisions: [],
      aiSuggestedActionItems: [],
    })

    const text = Buffer.from(buffer).toString("latin1")
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
    // jsPDF writes uncompressed text streams by default, so the rendered
    // strings are literally present in the output bytes.
    expect(text).toContain("Project: Skyline Tower A")
    expect(text).toContain("Close RFI-12")
    expect(text).toContain("Order rebar")
    expect(text).toMatch(/Page 1 of \d+/)
    expect(text).toMatch(/Page 2 of \d+/)
  })

  test("labels the AI's suggestions separately when real action items are present", () => {
    const withBoth = Buffer.from(generateMeetingMinutesPdf({
      systemId: "MOM-2026-0008",
      projectName: null,
      title: "Design Review",
      meetingType: "client",
      scheduledAt: "2026-08-28T04:30:00.000Z",
      status: "draft",
      attendees: [],
      agenda: [],
      minutes: "Reviewed the facade options.",
      actionItems: [{ title: "Issue revised elevation", owner: "Priya Nair", dueDate: null, status: "in_progress" }],
      aiSummary: null,
      aiKeyDecisions: [],
      aiSuggestedActionItems: [{ title: "Chase the glazing quote", assignee: null, dueDateHint: null }],
    })).toString("latin1")

    expect(withBoth).toContain("AI-Suggested Action Items")
    expect(withBoth).toContain("Issue revised elevation")
    expect(withBoth).toContain("Chase the glazing quote")
  })
})
