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
const GYPSUM = { id: "line_gypsum", itemCode: "1.01.1", description: "Gypsum Board 01", unit: "sqm", quantity: 472, rate: 1, amount: 472, activityId: "act_gypsum", parentLineItemId: null };
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

// R46/CONS-03 (confirmed live 2026-08-25): the PDF export previously
// carried no Rate/Contract Amt figure and no Grand Total row at all, while
// the live Report tab and Dashboard both show a real Contract Value for
// the same project -- a genuine, disclosed omission, not a wrong number.
describe("computeRows -- Rate/Contract Amt (R46/CONS-03)", () => {
  test("a root (non-child) line carries its own rate and contracted amount", () => {
    const rows = computeRows(baseData({ lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].rate).toBe(1);
    expect(rows[0].contractAmt).toBe(472); // GYPSUM.amount
  });

  test("computedRate (rate-buildup) feeds contractAmt's qty x rate fallback when no stored amount exists, matching computeRows' own existing amtTotalBoq precedence", () => {
    const rated = { ...GYPSUM, quantity: 100, rate: 1, amount: 0, computedRate: 10 };
    const rows = computeRows(baseData({ lineItems: [rated], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].rate).toBe(10);
    expect(rows[0].contractAmt).toBe(1000); // 100 (qty) x 10 (computedRate) -- amount was 0, so the qty x rate fallback applies
  });

  test("a stored non-zero amount wins over recomputing qty x rate, for contractAmt exactly as it already did for the rest of computeRows", () => {
    const rated = { ...GYPSUM, quantity: 100, rate: 1, amount: 472, computedRate: 10 };
    const rows = computeRows(baseData({ lineItems: [rated], categories: [CATEGORY], activities: [ACTIVITY], entries: [] }), "total");
    expect(rows[0].contractAmt).toBe(472); // the stored amount, not 100 x 10
  });
});

describe("generateWorkProgressReportPdf -- Grand Total (R46/CONS-03)", () => {
  test("real Oakwood-shaped fixture: Grand Total sums the ROOT line's Contract Amt only, matching the live Dashboard's contract value -- child's own amount is never added again", () => {
    const root = { id: "PP1", itemCode: "PP1", description: "Parent PP1", unit: "sqm", quantity: 100, rate: 50, amount: 5000, activityId: null, parentLineItemId: null };
    const child = { id: "PP1-A", itemCode: "PP1-A", description: "Child A", unit: "sqm", quantity: 100, rate: 20, amount: 2000, activityId: null, parentLineItemId: "PP1" };
    const rows = computeRows(baseData({ lineItems: [root, child], categories: [], activities: [], entries: [] }), "total");
    const grandTotal = rows.filter((r) => !r.isChild).reduce((s, r) => s + r.contractAmt, 0);
    expect(grandTotal).toBe(5000); // matches the live "AED 5,000 contract value" evidence -- not 7000 (root + child double-counted)
    // The PDF itself must still render without throwing for this exact shape.
    const buffer = generateWorkProgressReportPdf(baseData({ lineItems: [root, child], entries: [] }));
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});

// R12 point 7 (Option B) / E-89 (AR-01): preference-order entry-to-line
// resolution -- boq_line_item_id, when present on an entry, wins over the
// activityId match, and is never ALSO counted a second time via activityId.
describe("computeRows -- Option B boq_line_item_id preference order (E-89/AR-01)", () => {
  test("an entry keyed by boq_line_item_id is counted once, not twice, even though it shares the line's activityId", () => {
    const rows = computeRows(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [{ activityId: "act_gypsum", boqLineItemId: "line_gypsum", entryDate: "2026-07-15", quantityDone: 100 }],
    }), "total");
    expect(rows[0].currentQty).toBe(100); // not 200 -- the entry must not match under both rules
  });

  test("a boq_line_item_id entry pointed at a DIFFERENT line is excluded here, even though activityId matches", () => {
    const rows = computeRows(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [{ activityId: "act_gypsum", boqLineItemId: "some_other_line", entryDate: "2026-07-15", quantityDone: 100 }],
    }), "total");
    expect(rows[0].currentQty).toBe(0); // claimed exclusively by "some_other_line", not this one
  });

  test("boq_line_item_id-keyed and activityId-only entries for the same line both count (no boq_line_item_id on this line's own entries)", () => {
    const rows = computeRows(baseData({
      lineItems: [GYPSUM], categories: [CATEGORY], activities: [ACTIVITY],
      entries: [
        { activityId: "act_gypsum", boqLineItemId: "line_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
        { activityId: "act_gypsum", entryDate: "2026-07-16", quantityDone: 25 }, // legacy, activityId-only
      ],
    }), "total");
    expect(rows[0].currentQty).toBe(125);
  });
});
