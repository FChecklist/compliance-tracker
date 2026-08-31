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

export type MeetingMinutesPdfData = {
  systemId: string | null
  title: string
  meetingType: string
  scheduledAt: string | Date
  status: string
  attendees: string[]
  agenda: string[]
  minutes: string | null
  aiSummary: string | null
  aiKeyDecisions: string[]
  aiSuggestedActionItems: { title: string; assignee: string | null; dueDateHint: string | null }[]
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
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

  if (meeting.aiSuggestedActionItems.length) {
    if (y > 650) { doc.addPage(); y = 50 }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text("Action Items", marginX, y)
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

  return doc.output("arraybuffer")
}
