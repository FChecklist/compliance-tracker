/// <reference types="bun-types" />
// V2-1 (UAE country pack, 2026-07-20) -- the Multi-Country pluggability
// proof. This is the DONE CRITERION test the SUPERBOSS v2 plan §4 V2-1 names:
// "UAE + India both pass the same country-config test suite." It verifies
// the registry generalizes -- both countries resolve through the SAME
// getComplianceEngine() path, each exposes its OWN real statute slots (not a
// forced uniform shape), and an unregistered country still throws rather than
// silently defaulting to India. No India-specific hardcoding anywhere in this
// suite: every fixture carries its country, and the runner resolves through
// the registry, not a direct engine import, so a regression that re-binds
// 'ae' to India's modules (or drops 'ae') fails loudly here.
//
// House style: bun:test, data-driven fixtures + a `for...of` runner, and
// toMatchObject for the statutory-result objects (partial deep match -- same
// convention as golden-values.test.ts, which deliberately does NOT pin the
// optional `breakdown` wording). The fixture `expected` numbers are
// independently hand-computed from the cited statute, not from running the
// engine -- the engine is what's under test.
import { describe, test, expect } from "bun:test"
import { getComplianceEngine, getSupportedComplianceCountries } from "./compliance-engine-registry"

type CountryFixture = {
  country: string // ISO 3166-1 alpha-2
  description: string
  run: () => unknown
  expected: unknown
}

const FIXTURES: CountryFixture[] = [
  // ── Registry plumbing (the "same path, both countries" guarantee) ─────────
  {
    country: "IN",
    description: "getComplianceEngine('IN') resolves to the India engine set with incomeTax/tds/gst slots",
    run: () => {
      const e = getComplianceEngine("IN")
      return { country: e.country, hasIncomeTax: !!e.incomeTax, hasTds: !!e.tds, hasGst: !!e.gst, hasVat: !!e.vat, hasCorporateTax: !!e.corporateTax }
    },
    expected: { country: "IN", hasIncomeTax: true, hasTds: true, hasGst: true, hasVat: false, hasCorporateTax: false },
  },
  {
    country: "AE",
    description: "getComplianceEngine('AE') resolves to the UAE engine set with vat/corporateTax slots (no India slots)",
    run: () => {
      const e = getComplianceEngine("AE")
      return { country: e.country, hasIncomeTax: !!e.incomeTax, hasTds: !!e.tds, hasGst: !!e.gst, hasVat: !!e.vat, hasCorporateTax: !!e.corporateTax }
    },
    expected: { country: "AE", hasIncomeTax: false, hasTds: false, hasGst: false, hasVat: true, hasCorporateTax: true },
  },
  {
    country: "IN",
    description: "registry is case-insensitive ('in' lower and 'IN' upper resolve identically)",
    run: () => {
      const lower = getComplianceEngine("in").country
      const upper = getComplianceEngine("IN").country
      return lower === upper
    },
    expected: true,
  },
  {
    country: "AE",
    description: "registry is case-insensitive ('ae' lower and 'AE' upper resolve identically)",
    run: () => {
      const lower = getComplianceEngine("ae").country
      const upper = getComplianceEngine("AE").country
      return lower === upper
    },
    expected: true,
  },
  {
    country: "IN",
    description: "getSupportedComplianceCountries lists BOTH IN and AE (the architecture generalizes past one country)",
    run: () => getSupportedComplianceCountries().sort(),
    expected: ["AE", "IN"],
  },

  // ── India real-statute golden values (resolved THROUGH the registry, not a
  // direct import, so the wiring is what's proven) ──────────────────────────
  {
    country: "IN",
    description: "India income tax: 12,00,000 at the Sec 87A full-rebate limit owes zero tax",
    run: () => getComplianceEngine("IN").incomeTax!.calculateIncomeTax(1_200_000),
    expected: { grossTax: 60000, rebate87A: 60000, taxAfterRebate: 0, cess: 0, totalTaxPayable: 0 },
  },
  {
    country: "IN",
    description: "India income tax: 15,00,000 new-regime, above the 87A limit, no rebate, cess @ 4%",
    run: () => getComplianceEngine("IN").incomeTax!.calculateIncomeTax(1_500_000),
    expected: { grossTax: 105000, rebate87A: 0, taxAfterRebate: 105000, cess: 4200, totalTaxPayable: 109200 },
  },
  {
    country: "IN",
    description: "India GST: intra-state split of 1,00,000 @ 18% -> 9,000 CGST + 9,000 SGST, 0 IGST",
    run: () => getComplianceEngine("IN").gst!.splitGst({ taxableAmount: 100000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27" }),
    expected: { cgst: 9000, sgst: 9000, igst: 0, totalTax: 18000, totalAmount: 118000, isInterState: false },
  },
  {
    country: "IN",
    description: "India GST: inter-state split of 1,00,000 @ 18% -> 0 CGST + 0 SGST + 18,000 IGST",
    run: () => getComplianceEngine("IN").gst!.splitGst({ taxableAmount: 100000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "07" }),
    expected: { cgst: 0, sgst: 0, igst: 18000, totalTax: 18000, totalAmount: 118000, isInterState: true },
  },
  {
    country: "IN",
    description: "India TDS: Sec 194J professional fees, 30,000 payment at threshold, no PAN, 20% Sec 206AA override applies",
    run: () => getComplianceEngine("IN").tds!.computeTdsForSection("194J", 30000, 30000, false),
    expected: { tdsAmount: 6000, ratePercent: 20, applicable: true },
  },

  // ── UAE real-statute golden values (resolved THROUGH the registry) ────────
  {
    country: "AE",
    description: "UAE VAT: standard-rated 100,000 exclusive -> 5,000 VAT, total 105,000 (FTA Decree-Law 8/2017, 5%)",
    run: () => getComplianceEngine("AE").vat!.calculateVat({ taxableAmount: 100000 }),
    expected: { supplyType: "standard_rated", ratePercent: 5, taxableAmount: 100000, vatAmount: 5000, totalAmount: 105000 },
  },
  {
    country: "AE",
    description: "UAE VAT: inclusive 105,000 standard-rated -> back-calc taxable 100,000 + VAT 5,000",
    run: () => getComplianceEngine("AE").vat!.calculateVat({ taxableAmount: 105000, amountIsInclusive: true }),
    expected: { supplyType: "standard_rated", taxableAmount: 100000, vatAmount: 5000, totalAmount: 105000 },
  },
  {
    country: "AE",
    description: "UAE VAT: export_of_goods is zero-rated (0% VAT, input tax still recoverable)",
    run: () => getComplianceEngine("AE").vat!.calculateVat({ taxableAmount: 100000, supplyCategory: "export_of_goods" }),
    expected: { supplyType: "zero_rated", ratePercent: 0, vatAmount: 0, totalAmount: 100000 },
  },
  {
    country: "AE",
    description: "UAE VAT: financial_services_specified is exempt (0% VAT, supplyType exempt, input NOT recoverable)",
    run: () => getComplianceEngine("AE").vat!.calculateVat({ taxableAmount: 100000, supplyCategory: "financial_services_specified" }),
    expected: { supplyType: "exempt", ratePercent: 0, vatAmount: 0, totalAmount: 100000 },
  },
  {
    country: "AE",
    description: "UAE VAT input-tax recovery: 60% taxable / 40% exempt -> 60% of 1,000 input VAT recoverable = 600",
    run: () => getComplianceEngine("AE").vat!.recoverableInputVat({ inputVatPaid: 1000, taxableSuppliesValue: 600, exemptSuppliesValue: 400 }),
    expected: { recoverableInputVat: 600, nonRecoverableInputVat: 400 },
  },
  {
    country: "AE",
    description: "UAE VAT TRN format: 15 digits valid, 14 digits invalid",
    run: () => ({
      valid15: getComplianceEngine("AE").vat!.isValidTrnFormat("100123456789012"),
      invalid14: getComplianceEngine("AE").vat!.isValidTrnFormat("10012345678901"),
    }),
    expected: { valid15: true, invalid14: false },
  },
  {
    country: "AE",
    description: "UAE Corporate Tax: standard regime, 375,000 (at the 0% threshold ceiling) -> zero tax (Decree-Law 47/2022 Art. 3)",
    run: () => getComplianceEngine("AE").corporateTax!.calculateCorporateTax({ taxableIncome: 375000 }),
    expected: { regime: "standard", ratePercent: 9, taxBeforePillarTwo: 0, pillarTwoTopUp: 0, totalTaxPayable: 0 },
  },
  {
    country: "AE",
    description: "UAE Corporate Tax: standard regime, 1,000,000 -> 9% only on the 625,000 above the 375k threshold = 56,250",
    run: () => getComplianceEngine("AE").corporateTax!.calculateCorporateTax({ taxableIncome: 1_000_000 }),
    expected: { regime: "standard", ratePercent: 9, taxBeforePillarTwo: 56250, pillarTwoTopUp: 0, totalTaxPayable: 56250 },
  },
  {
    country: "AE",
    description: "UAE Corporate Tax: QFZP regime, 1,000,000 total with 200,000 non-qualifying -> 9% on 200k = 18,000, qualifying 800k at 0%",
    run: () => getComplianceEngine("AE").corporateTax!.calculateCorporateTax({ taxableIncome: 1_000_000, regime: "qualifying_free_zone", nonQualifyingIncome: 200000 }),
    expected: { regime: "qualifying_free_zone", ratePercent: 9, taxBeforePillarTwo: 18000, pillarTwoTopUp: 0, totalTaxPayable: 18000 },
  },
  {
    country: "AE",
    description: "UAE Corporate Tax: Pillar Two top-up — MNE with EUR 800M revenue, 1,000,000 taxable, standard regime pays 56,250 (5.625% effective), top-up to 15% = 93,750 extra",
    run: () => getComplianceEngine("AE").corporateTax!.calculateCorporateTax({
      taxableIncome: 1_000_000,
      isMneSubjectToPillarTwo: true,
      mneConsolidatedRevenueEur: 800_000_000,
    }),
    expected: { regime: "standard", taxBeforePillarTwo: 56250, pillarTwoTopUp: 93750, totalTaxPayable: 150000 },
  },
]

describe("V2-1 Multi-Country country-config suite (IN + AE resolve through getComplianceEngine)", () => {
  for (const fixture of FIXTURES) {
    test(`[${fixture.country}] ${fixture.description}`, () => {
      const actual = fixture.run()
      if (typeof fixture.expected === "object" && fixture.expected !== null) {
        expect(actual).toMatchObject(fixture.expected as Record<string, unknown>)
      } else {
        expect(actual).toBe(fixture.expected)
      }
    })
  }
})

// The "no silent India default" guarantee -- an unregistered country MUST
// throw, not fall back to India's rules. This is the single most important
// architectural property of the registry: the second country existing must
// not have weakened the "unknown = explicit error" contract that keeps a
// future country from accidentally running the wrong nation's tax logic.
describe("V2-1 country-config registry: unregistered country throws (no silent fallback)", () => {
  test("an unregistered country code (US) throws with a message listing the registered countries", () => {
    expect(() => getComplianceEngine("US")).toThrow(/No compliance engine registered for country: US/)
  })
  test("the error message names BOTH registered countries (so a caller sees AE exists, not just IN)", () => {
    expect(() => getComplianceEngine("GB")).toThrow(/AE/)
    expect(() => getComplianceEngine("GB")).toThrow(/IN/)
  })
  test("empty/null/whitespace country throws rather than silently returning India", () => {
    expect(() => getComplianceEngine("")).toThrow()
    expect(() => getComplianceEngine("   ")).toThrow()
    expect(() => getComplianceEngine(null as unknown as string)).toThrow()
  })
})
