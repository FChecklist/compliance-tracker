/// <reference types="bun-types" />
// VERIDIAN Review Framework, "Overall Code Quality Score" (Medium) gap
// closure: task-execution-engine.test.ts's own header explicitly scopes
// itself to buildNovelUmrHint() only and states everything DB/LLM-touching
// (including dispatchEngine(), pre-split) "stays untested here" -- so
// dispatchEngine() had zero coverage before this file, same as dispatchTool()
// (now in tool-dispatch.ts). dispatchEngine is the more tractable of the two
// to cover meaningfully without a live DB: the large majority of its ~50
// engineKey branches are pure calculators reached via `await import(...)`
// (mathematical/costing/GST/etc. engine files), with only one branch
// (gst_return_validation_engine) touching the DB at all. Mirrors dispatch-
// completion-monitor.test.ts's own precedent for a TenantDb fake shaped only
// as far as the function under test actually reads from it (cast through
// `unknown`), so this suite never opens a live DB connection.
//
// Deliberately a representative sample, not exhaustive per-branch coverage:
// one pure case per major category actually reachable via the plain
// `switch (engineKey)` blocks, the one DB-touching branch (success + both
// its error paths), and the final unknown-engineKey fallthrough.
import { describe, test, expect } from "bun:test"
import { dispatchEngine } from "./engine-dispatch"
import type { TenantDb } from "@/lib/db/tenant-scoped"

describe("dispatchEngine -- pure calculator branches", () => {
  test("basic_arithmetic_engine: dispatches 'add' to the real Decimal-backed adder", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "basic_arithmetic_engine", { operation: "add", a: 2, b: 3 });
    expect(result).toEqual({ result: 5 });
  });

  test("basic_arithmetic_engine: an unrecognized operation throws 'Invalid operation'", async () => {
    await expect(
      dispatchEngine({} as TenantDb, "org-1", "basic_arithmetic_engine", { operation: "exponentiate", a: 2, b: 3 })
    ).rejects.toThrow("Invalid operation");
  });

  test("percentage_engine: 'percentage_of' computes value1% of value2", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "percentage_engine", { operation: "percentage_of", value1: 50, value2: 200 });
    expect(result).toEqual({ result: 100 });
  });

  test("gst_split_engine: same-state (intra-state) split returns cgst+sgst, not igst", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "gst_split_engine", {
      taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27",
    }) as { cgst: number; sgst: number; igst: number; isInterState: boolean };
    expect(result.isInterState).toBe(false);
    expect(result.cgst).toBe(90);
    expect(result.sgst).toBe(90);
    expect(result.igst).toBe(0);
  });

  test("gst_split_engine: cross-state (inter-state) split returns igst only", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "gst_split_engine", {
      taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "07",
    }) as { cgst: number; sgst: number; igst: number; isInterState: boolean };
    expect(result.isInterState).toBe(true);
    expect(result.igst).toBe(180);
    expect(result.cgst).toBe(0);
  });

  test("job_costing_engine: sums direct material/labor/overhead into a real total", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "job_costing_engine", {
      directMaterial: 100, directLabor: 50, overheadAllocated: 25,
    });
    expect(result).toEqual({ result: 175 });
  });

  test("hsn_validation_engine: rejects a malformed HSN code without throwing", async () => {
    const result = await dispatchEngine({} as TenantDb, "org-1", "hsn_validation_engine", { hsn: "abc" });
    expect(result).toEqual({ valid: false });
  });
});

describe("dispatchEngine -- error paths", () => {
  test("an engineKey with no dispatcher throws a clear, named error", async () => {
    await expect(
      dispatchEngine({} as TenantDb, "org-1", "not_a_real_engine", {})
    ).rejects.toThrow("No engine dispatcher implemented for not_a_real_engine");
  });

  test("scientific_calculator_engine: a malformed expression throws rather than returning NaN", async () => {
    await expect(
      dispatchEngine({} as TenantDb, "org-1", "scientific_calculator_engine", { expr: "not an expression (" })
    ).rejects.toThrow();
  });
});

describe("dispatchEngine -- gst_return_validation_engine (the one DB-touching branch)", () => {
  function fakeDb(period: unknown, invoices: unknown[]): TenantDb {
    return {
      query: {
        gstReturnPeriods: { findFirst: async () => period },
        gstCanonicalInvoices: { findMany: async () => invoices },
      },
    } as unknown as TenantDb;
  }

  test("missing returnPeriodId throws before touching the DB", async () => {
    await expect(
      dispatchEngine({} as TenantDb, "org-1", "gst_return_validation_engine", {})
    ).rejects.toThrow("Missing returnPeriodId");
  });

  test("a returnPeriodId that doesn't resolve to a real row throws 'Return period not found'", async () => {
    const db = fakeDb(undefined, []);
    await expect(
      dispatchEngine(db, "org-1", "gst_return_validation_engine", { returnPeriodId: "rp-missing" })
    ).rejects.toThrow("Return period not found");
  });

  test("a real return period + confirmed sales invoices validates as valid via the real gst-engine", async () => {
    const db = fakeDb(
      { id: "rp-1", orgId: "org-1", period: "042026", gstin: "27AAAAA0000A1Z5" },
      [
        { invoiceNumber: "INV-1", taxableValue: "1000", cgstAmount: "90", sgstAmount: "90", igstAmount: "0", totalValue: "1180" },
        { invoiceNumber: "INV-2", taxableValue: "500", cgstAmount: "45", sgstAmount: "45", igstAmount: "0", totalValue: "590" },
      ]
    );
    const result = await dispatchEngine(db, "org-1", "gst_return_validation_engine", { returnPeriodId: "rp-1" }) as { valid: boolean; errors: string[] };
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("a real return period with zero confirmed sales invoices fails validation with a clear reason", async () => {
    const db = fakeDb({ id: "rp-2", orgId: "org-1", period: "052026", gstin: "27AAAAA0000A1Z5" }, []);
    const result = await dispatchEngine(db, "org-1", "gst_return_validation_engine", { returnPeriodId: "rp-2" }) as { valid: boolean; errors: string[] };
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one line item is required");
  });
});
