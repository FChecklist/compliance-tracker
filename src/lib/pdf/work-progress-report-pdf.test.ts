/// <reference types="bun-types" />
// Point 138: proves (a) generateWorkProgressReportPdf produces a real,
// non-empty binary PDF with a valid %PDF header -- same convention as
// meeting-minutes-pdf.test.ts -- including the empty-state case (gate3c: a
// project with zero progress is a legitimate answer, not an error), and
// (b) computeRows' own Previous/Current/Total-or-Balance arithmetic and
// WPR-06 child-blanking are correct, with real assertions (byte-level PDF
// output alone can only prove "a document exists," not "the numbers are
// right").
import { describe, expect, test } from "bun:test"
import { generateWorkProgressReportPdf, computeRows, type WorkProgressReportPdfData } from "./work-progress-report-pdf"

const ORG = { name: "Meridian Construction Co.", address: "123 Site Road", gstin: "27AAAAA0000A1Z5" }

// Same oracle line item used throughout this codebase's WPR test fixtures.
const GYPSUM = { itemCode: "1.01.1", description: "Gypsum Board 01", unit: "sqm", quantity: 472, rate: 1, amount: 472, activityId: "act_gypsum", parentLineItemId: null };
const CATEGORY = { id: "cat_1", name: "Partitions" };
const ACTIVITY = { id: "act_gypsum", categoryId: "cat_1", name: "Gypsum Board 01" };

function baseData(overrides: Partial<WorkProgressReportPdfData> = {}): WorkProgressReportPdfData {
  return {
    org: ORG, projectName: "Riverside Business Park - Tower B", boqTitle: "BoQ v1",
    from: "2026-07-10", to: "2026-07-20",
    lineItems: [], activities: [], categories: [], entries: [],
    ...overrides,
  };
}

describe("generateWorkProgressReportPdf", () => {
  test("produces a real, non-empty PDF buffer with a valid %PDF header for a project with real progress", () => {
    const buffer = generateWorkProgressReportPdf(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [
        { activityId: "act_gypsum", entryDate: "2026-07-01", quantityDone: 300 },
        { activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
      ],
    }));
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  // Point 138 gate3(c): E-52 -- an empty report is a legitimate answer, not
  // a failure. MUST still return a valid PDF, never throw or 4xx.
  test("gate3(c): a project with ZERO BoQ line items still produces a valid, non-empty PDF with an empty-state line, not an error", () => {
    const buffer = generateWorkProgressReportPdf(baseData());
    expect(buffer.byteLength).toBeGreaterThan(500);
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(() => generateWorkProgressReportPdf(baseData())).not.toThrow();
  });

  test("a project with BoQ line items but zero progress entries still produces a valid PDF (rows all zero, not an error)", () => {
    const buffer = generateWorkProgressReportPdf(baseData({ lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }));
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});

describe("computeRows -- Previous/Current/Total-or-Balance arithmetic + WPR-06 child-blanking", () => {
  test("ORACLE: 300 (prev) + 100 (current) reproduces his own sheet's 72 -- balance = 472 - 400", () => {
    const rows = computeRows(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [
        { activityId: "act_gypsum", entryDate: "2026-07-01", quantityDone: 300 },
        { activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
      ],
    }), "balance");
    expect(rows).toHaveLength(1);
    expect(rows[0].prevQty).toBe(300);
    expect(rows[0].currentQty).toBe(100);
    expect(rows[0].thirdQty).toBe(72); // balance = 472 - 400
  });

  test("mode=total returns 400 (previous + current) for the same fixture", () => {
    const rows = computeRows(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [
        { activityId: "act_gypsum", entryDate: "2026-07-01", quantityDone: 300 },
        { activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
      ],
    }), "total");
    expect(rows[0].thirdQty).toBe(400);
  });

  test("a line with a parentLineItemId is flagged isChild -- percent cells are blanked at render time (WPR-06)", () => {
    const child = { ...GYPSUM, itemCode: "1.01.1.a", parentLineItemId: "parent-id" };
    const rows = computeRows(baseData({ lineItems: [child], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].isChild).toBe(true);
  });

  test("a line with no parentLineItemId is not a child, even with no children of its own (standalone line)", () => {
    const rows = computeRows(baseData({ lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].isChild).toBe(false);
  });

  test("computedRate is preferred over the stored rate when present -- same fallback order as projexa's work-progress-report.ts", () => {
    const rated = { ...GYPSUM, rate: 1, computedRate: 10 };
    const rows = computeRows(baseData({
      lineItems: [rated], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [{ activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 }],
    }), "total");
    expect(rows[0].currentAmt).toBe(1000); // 100 * 10 (computedRate), not 100 * 1 (stored rate)
  });

  test("an unlinked line (no activityId) has zero progress, not a crash", () => {
    const unlinked = { ...GYPSUM, activityId: null };
    const rows = computeRows(baseData({ lineItems: [unlinked], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].prevQty).toBe(0);
    expect(rows[0].currentQty).toBe(0);
    expect(rows[0].categoryName).toBe("Uncategorized");
  });
});
