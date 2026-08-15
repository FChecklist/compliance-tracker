/// <reference types="bun-types" />
// VCEL Formula Testing Framework (VERIDIAN Review Framework gap closure,
// 2026-07-18). Before this file: zero test coverage existed anywhere for
// src/lib/engines/** (confirmed via a repo-wide search before writing this
// -- see PROGRESS.md for the full trail). A statutory-formula bug (a wrong
// slab boundary, a mis-applied divisor) had no automated way to be caught.
//
// This is deliberately a data-driven GOLDEN-VALUE suite, not hand-written
// per-engine unit tests: each fixture below states a real, independently
// hand-computed statutory result (income tax slabs, GST split, Payment of
// Gratuity Act, TDS section rates, EPS) for a specific input, and the
// runner just calls the real engine function and diffs it. Adding coverage
// for another "implemented" engine is a new fixture entry, not new test
// boilerplate -- that data-driven shape is what makes this a reusable
// framework/product capability rather than one-off ad hoc tests (the exact
// distinction the "Formula Testing Framework" finding drew).
//
// Every fixture's `expected` is checked with toMatchObject (partial deep
// match) rather than toEqual -- these engines were given an optional
// `breakdown` field for Calculation Explainability (see breakdown.ts) that
// this suite intentionally does NOT pin down field-by-field (that would
// make the suite brittle to wording changes in the explanation text while
// adding no real correctness coverage); it verifies the actual computed
// numbers, which is the statutory-correctness guarantee this framework
// exists for.
import { describe, test, expect } from "bun:test"
import { calculateIncomeTax } from "./in/income-tax-engine"
import { splitGst } from "./in/gst-engine"
import { calculateGratuity, calculateEps } from "./payroll-engine"
import { calculateTcs, computeTdsForSection } from "./in/tds-engine"

type GoldenFixture = {
  domain: string
  description: string
  run: () => unknown
  expected: unknown
}

const FIXTURES: GoldenFixture[] = [
  // ── Income Tax (Sec 87A rebate + slab-wise new-regime computation) ──────
  {
    domain: "Income Tax",
    description: "Taxable income exactly at the Sec 87A full-rebate limit (12,00,000) owes zero tax",
    run: () => calculateIncomeTax(1_200_000),
    expected: { grossTax: 60000, rebate87A: 60000, taxAfterRebate: 0, cess: 0, totalTaxPayable: 0 },
  },
  {
    domain: "Income Tax",
    description: "15,00,000 taxable income, new-regime slabs, no rebate (above the 87A limit)",
    run: () => calculateIncomeTax(1_500_000),
    expected: { grossTax: 105000, rebate87A: 0, taxAfterRebate: 105000, cess: 4200, totalTaxPayable: 109200 },
  },
  {
    domain: "Income Tax",
    description: "25,00,000 taxable income spans every slab including the top 30% band",
    run: () => calculateIncomeTax(2_500_000),
    expected: { grossTax: 330000, rebate87A: 0, taxAfterRebate: 330000, cess: 13200, totalTaxPayable: 343200 },
  },
  {
    domain: "Income Tax",
    description: "Income entirely within the 0% slab (below 4,00,000) owes nothing",
    run: () => calculateIncomeTax(300_000),
    expected: { grossTax: 0, rebate87A: 0, taxAfterRebate: 0, cess: 0, totalTaxPayable: 0 },
  },

  // ── GST Split (CGST Act Sec 8/9 intra-state vs. inter-state IGST) ───────
  {
    domain: "GST",
    description: "Intra-state supply (same state code) splits 18% GST evenly into CGST+SGST",
    run: () => splitGst({ taxableAmount: 100_000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27" }),
    expected: { cgst: 9000, sgst: 9000, igst: 0, totalTax: 18000, totalAmount: 118000, isInterState: false },
  },
  {
    domain: "GST",
    description: "Inter-state supply (different state codes) charges IGST only",
    run: () => splitGst({ taxableAmount: 100_000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "09" }),
    expected: { cgst: 0, sgst: 0, igst: 18000, totalTax: 18000, totalAmount: 118000, isInterState: true },
  },
  {
    domain: "GST",
    description: "5% intra-state GST on 50,000",
    run: () => splitGst({ taxableAmount: 50_000, gstRatePercent: 5, supplierStateCode: "07", buyerStateCode: "07" }),
    expected: { cgst: 1250, sgst: 1250, igst: 0, totalTax: 2500, totalAmount: 52500, isInterState: false },
  },

  // ── Gratuity (Payment of Gratuity Act, 1972, Sec 4) ─────────────────────
  {
    domain: "Gratuity",
    description: "Covered establishment (15/26 formula), 10.5 years rounds up to 11 (Sec 4(2))",
    run: () => calculateGratuity({ lastDrawnMonthlySalary: 50_000, yearsOfService: 10.5 }),
    expected: { gratuityAmount: 317307.69, roundedYearsOfService: 11, statutoryCapApplied: false },
  },
  {
    domain: "Gratuity",
    description: "High salary x long service exceeds the Rs 20 lakh statutory cap",
    run: () => calculateGratuity({ lastDrawnMonthlySalary: 500_000, yearsOfService: 30 }),
    expected: { gratuityAmount: 2_000_000, roundedYearsOfService: 30, statutoryCapApplied: true },
  },
  {
    domain: "Gratuity",
    description: "Non-covered establishment (15/30 formula), 5.4 years rounds down to 5",
    run: () => calculateGratuity({ lastDrawnMonthlySalary: 40_000, yearsOfService: 5.4, isCoveredUnderAct: false }),
    expected: { gratuityAmount: 100_000, roundedYearsOfService: 5, statutoryCapApplied: false },
  },

  // ── TDS (Income Tax Act Chapter XVII-B) ──────────────────────────────────
  {
    domain: "TDS",
    description: "Sec 194C payment above the 30,000 threshold: 2% TDS applies",
    run: () => computeTdsForSection("194C", 50_000, 50_000, true),
    expected: { tdsAmount: 1000, ratePercent: 2, applicable: true },
  },
  {
    domain: "TDS",
    description: "Sec 194C cumulative payment below the 30,000 threshold: no TDS",
    run: () => computeTdsForSection("194C", 20_000, 20_000, true),
    expected: { tdsAmount: 0, ratePercent: 2, applicable: false },
  },
  {
    domain: "TDS",
    description: "Sec 206AA no-PAN override forces the higher of section rate or 20%",
    run: () => computeTdsForSection("194J", 50_000, 50_000, false),
    expected: { tdsAmount: 10000, ratePercent: 20, applicable: true },
  },
  {
    domain: "TDS",
    description: "Sec 206C TCS on sale value above threshold",
    run: () => calculateTcs(100_000, 1, 50_000),
    expected: { tcsAmount: 500, applicableValue: 50_000 },
  },

  // ── EPS (EPFO Pension Fund contribution, employer share) ────────────────
  {
    domain: "EPS",
    description: "Wage above the Rs 15,000 EPS ceiling is capped before the 8.33% rate applies",
    run: () => calculateEps(20_000),
    expected: 1249.5,
  },
  {
    domain: "EPS",
    description: "Wage below the EPS ceiling uses the actual wage",
    run: () => calculateEps(10_000),
    expected: 833,
  },
]

describe("VCEL Formula Testing Framework: golden-value regression suite", () => {
  for (const fixture of FIXTURES) {
    test(`[${fixture.domain}] ${fixture.description}`, () => {
      const actual = fixture.run()
      if (typeof fixture.expected === "object" && fixture.expected !== null) {
        expect(actual).toMatchObject(fixture.expected as Record<string, unknown>)
      } else {
        expect(actual).toBe(fixture.expected)
      }
    })
  }
})
