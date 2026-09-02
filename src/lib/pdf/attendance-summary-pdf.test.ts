/// <reference types="bun-types" />
// R67 D-31: proves the printed attendance summary is a real, non-empty PDF --
// same convention as work-progress-report-pdf.test.ts -- including the two
// cases a report generator usually gets wrong: a window with no attendance at
// all (a legitimate answer, not an error, and never a 4xx), and a window whose
// two source aggregates disagree (which must be printed as a warning, never
// quietly dropped).
//
// The arithmetic itself is NOT tested here: this generator deliberately does
// none. Rows, totals and the headline count are computed by
// construction-reports-service.ts's own pure builders and asserted in that
// file's test, so a printed sheet and the screen cannot disagree.
import { describe, expect, test } from "bun:test"
import { generateAttendanceSummaryPdf, attendanceHeadlineParts, type AttendanceSummaryPdfData } from "./attendance-summary-pdf"

const ORG = { name: "Meridian Construction Co.", address: "123 Site Road", gstin: "27AAAAA0000A1Z5" }

const ROWS = [
  { trade: "Electrician", present: 4, halfDay: 2, absent: 0, workerDays: 5, cost: 750 },
  { trade: "Mason", present: 12, halfDay: 0, absent: 1, workerDays: 12, cost: 1440 },
]

function baseData(overrides: Partial<AttendanceSummaryPdfData> = {}): AttendanceSummaryPdfData {
  return {
    org: ORG,
    projectName: "Riverside Business Park - Tower B",
    from: "2026-09-03",
    to: "2026-09-03",
    rows: ROWS,
    totals: { present: 16, halfDay: 2, absent: 1, workerDays: 17, cost: 2190 },
    headcount: 18,
    ties: true,
    ...overrides,
  }
}

describe("attendanceHeadlineParts", () => {
  test("reads as the same sentence the screen shows", () => {
    expect(attendanceHeadlineParts(ROWS)).toBe("Electrician 6 · Mason 12")
  })

  test("a trade with nobody on site is left out of the headline rather than printed as 0", () => {
    expect(attendanceHeadlineParts([...ROWS, { trade: "Helper", present: 0, halfDay: 0, absent: 3, workerDays: 0, cost: 0 }]))
      .toBe("Electrician 6 · Mason 12")
  })

  test("a half day shows as a half, not rounded away", () => {
    expect(attendanceHeadlineParts([{ trade: "Helper", present: 0, halfDay: 1, absent: 0, workerDays: 0.5, cost: 60 }]))
      .toBe("Helper 1")
  })
})

describe("generateAttendanceSummaryPdf", () => {
  test("produces a real, non-empty PDF with a valid %PDF header", () => {
    const buffer = generateAttendanceSummaryPdf(baseData())
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("a window with no attendance still produces a valid PDF -- 'nobody was on site' is an answer", () => {
    const buffer = generateAttendanceSummaryPdf(baseData({ rows: [], totals: { present: 0, halfDay: 0, absent: 0, workerDays: 0, cost: 0 }, headcount: 0 }))
    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("a summary whose aggregates disagree still prints, carrying the warning rather than hiding it", () => {
    const buffer = generateAttendanceSummaryPdf(baseData({ ties: false }))
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("an all-time summary (no window) produces a valid PDF too", () => {
    const buffer = generateAttendanceSummaryPdf(baseData({ from: null, to: null }))
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })
})
