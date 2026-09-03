// Wave 143 (PROJEXA Minutes of Meetings): second real PDF-generation call
// site in this codebase, same jsPDF/jspdf-autotable stack as
// quotation-pdf.ts (the first, Priority 15 Wave 2) -- no new PDF dependency
// introduced. Pure function over a plain data shape (not
// Awaited<ReturnType<getVeriMeeting>> directly) so it stays independently
// unit-testable without a DB/tenant-context dependency, matching this
// task's own success criterion of proving a real, non-empty PDF buffer.
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

const NAVY: [number, number, number] = [28, 43, 58]
const MUTED: [number, number, number] = [100, 100, 100]

/** jspdf-autotable writes the finished table's bottom edge back onto the doc; it is not in jsPDF's own types. */
type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } }

// R67 lane D22 (item D-58, rec R-187): the MoM a site team actually sends out
// has to say which PROJECT it belongs to, list the action items that were
// really agreed (not only the ones an LLM guessed at), and be paginated so a
// three-page minute is readable as a document rather than as a stream. All
// three were missing: `projectName` did not exist, the Action Items table was
// built from `aiSuggestedActionItems` (the AI's suggestions, which may be
// empty on every human-typed meeting), and there were no page numbers.
//
// Both new fields are optional so every pre-existing caller keeps compiling
// and keeps producing the same document.
export type MeetingMinutesActionItem = {
  title: string
  owner: string | null
  dueDate: string | Date | null
  status: string | null
}

export type MeetingMinutesPdfData = {
  systemId: string | null
  /** The project this meeting belongs to. null for an org-level meeting with no project context. */
  projectName?: string | null
  title: string
  meetingType: string
  scheduledAt: string | Date
  status: string
  attendees: string[]
  agenda: string[]
  minutes: string | null
  /** The real, agreed action items (veri_meeting_action_items -> tasks), not the AI's suggestions. */
  actionItems?: MeetingMinutesActionItem[]
  aiSummary: string | null
  aiKeyDecisions: string[]
  aiSuggestedActionItems: { title: string; assignee: string | null; dueDateHint: string | null }[]
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

function formatDueDate(value: string | Date | null): string {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium" })
}

/**
 * "Page 2 of 5" on every page, written last so the total is known.
 *
 * jsPDF numbers pages from 1 and `getNumberOfPages()` is only final once all
 * content is laid out -- so this must run after the last write, not inside the
 * per-section code that adds the pages.
 */
function stampPageNumbers(doc: jsPDF): void {
  const total = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`Page ${page} of ${total}`, pageWidth / 2, pageHeight - 24, { align: "center" })
  }
}

export function generateMeetingMinutesPdf(meeting: MeetingMinutesPdfData): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 40
  let y = 50

  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text("MINUTES OF MEETING", marginX, y)
  y += 22

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text(meeting.title, marginX, y)
  y += 16

  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  const metaLines = [
    meeting.systemId ? `MoM #: ${meeting.systemId}` : null,
    meeting.projectName ? `Project: ${meeting.projectName}` : null,
    `Date: ${formatDate(meeting.scheduledAt)}`,
    `Type: ${meeting.meetingType}`,
    `Status: ${meeting.status.toUpperCase()}`,
  ].filter((l): l is string => !!l)
  for (const line of metaLines) {
    doc.text(line, marginX, y)
    y += 12
  }
  y += 8

  doc.setDrawColor(210, 210, 210)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 20

  if (meeting.attendees.length) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text("Attendees", marginX, y)
    y += 14
    doc.setFont("helvetica", "normal")
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)
    const attendeeLines = doc.splitTextToSize(meeting.attendees.join(", "), pageWidth - marginX * 2)
    doc.text(attendeeLines, marginX, y)
    y += attendeeLines.length * 12 + 14
  }

  if (meeting.agenda.length) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text("Agenda", marginX, y)
    y += 14
    doc.setFont("helvetica", "normal")
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9)
    for (const item of meeting.agenda) {
      const lines = doc.splitTextToSize(`• ${item}`, pageWidth - marginX * 2)
      doc.text(lines, marginX, y)
      y += lines.length * 12 + 2
    }
    y += 12
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text("Minutes", marginX, y)
  y += 14
  doc.setFont("helvetica", "normal")
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)
  const minutesLines = doc.splitTextToSize(meeting.minutes?.trim() || "(No minutes recorded yet)", pageWidth - marginX * 2)
  doc.text(minutesLines, marginX, y)
  y += minutesLines.length * 12 + 20

  if (meeting.aiSummary || meeting.aiKeyDecisions.length) {
    if (y > 700) { doc.addPage(); y = 50 }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text("AI Summary", marginX, y)
    y += 14
    if (meeting.aiSummary) {
      doc.setFont("helvetica", "normal")
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
      const summaryLines = doc.splitTextToSize(meeting.aiSummary, pageWidth - marginX * 2)
      doc.text(summaryLines, marginX, y)
      y += summaryLines.length * 12 + 10
    }
    if (meeting.aiKeyDecisions.length) {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(9)
      doc.setTextColor(...NAVY)
      doc.text("Key Decisions", marginX, y)
      y += 12
      doc.setFont("helvetica", "normal")
      doc.setTextColor(0, 0, 0)
      for (const decision of meeting.aiKeyDecisions) {
        const lines = doc.splitTextToSize(`• ${decision}`, pageWidth - marginX * 2)
        doc.text(lines, marginX, y)
        y += lines.length * 12 + 2
      }
      y += 10
    }
  }

  // The agreed action items come FIRST and under the plain heading, because
  // they are the part of a MoM anyone is held to. The AI's suggestions keep
  // their own clearly-labelled table below so a reader can never mistake a
  // machine's guess for something the room agreed.
  const agreed = meeting.actionItems ?? []
  if (agreed.length) {
    if (y > 650) { doc.addPage(); y = 50 }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text("Action Items", marginX, y)
    y += 10
    autoTable(doc, {
      startY: y,
      head: [["Item", "Owner", "Due", "Status"]],
      body: agreed.map((item) => [item.title, item.owner ?? "-", formatDueDate(item.dueDate), item.status ?? "-"]),
      margin: { left: marginX, right: marginX },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 6, textColor: [0, 0, 0] },
    })
    y = ((doc as AutoTableDoc).lastAutoTable?.finalY ?? y) + 20
  }

  if (meeting.aiSuggestedActionItems.length) {
    if (y > 650) { doc.addPage(); y = 50 }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text(agreed.length ? "AI-Suggested Action Items" : "Action Items", marginX, y)
    y += 10
    autoTable(doc, {
      startY: y,
      head: [["Item", "Assignee", "Due"]],
      body: meeting.aiSuggestedActionItems.map((item) => [item.title, item.assignee ?? "-", item.dueDateHint ?? "-"]),
      margin: { left: marginX, right: marginX },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 6, textColor: [0, 0, 0] },
    })
  }

  stampPageNumbers(doc)
  return doc.output("arraybuffer")
}
