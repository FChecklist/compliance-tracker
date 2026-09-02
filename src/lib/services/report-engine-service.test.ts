/// <reference types="bun-types" />
// Tests the pure validation/domain-derivation functions only --
// createReportDefinition()/executeReportDefinition()/runAggregation() all
// touch the DB and are deliberately left untested here, matching this
// repo's established pattern (see delegation-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import {
  validateReportDefinitionInput, deriveReportDomainFromClassifications, buildAggregationNote, isBillingScheduleDue,
  aggregateSalesByMaterialServiceType, usableBudget, type SalesByServiceTypeLine, type CreateReportDefinitionInput,
} from "./report-engine-service"

const BASE: CreateReportDefinitionInput = {
  name: "Test Report",
  description: "A test report definition",
  category: "software_report",
  classifications: ["project"],
  executionType: "deterministic_aggregation",
  executionConfig: { kind: "aggregation", tableKey: "compliance_items", aggregation: "count" },
}

describe("validateReportDefinitionInput", () => {
  test("accepts a well-formed built definition", () => {
    expect(validateReportDefinitionInput(BASE)).toEqual({ valid: true })
  })

  test("rejects an empty name", () => {
    expect(validateReportDefinitionInput({ ...BASE, name: "  " }).valid).toBe(false)
  })

  test("rejects an empty description", () => {
    expect(validateReportDefinitionInput({ ...BASE, description: "" }).valid).toBe(false)
  })

  test("rejects an invalid category", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateReportDefinitionInput({ ...BASE, category: "not_a_real_category" }).valid).toBe(false)
  })

  test("rejects an empty classifications array", () => {
    expect(validateReportDefinitionInput({ ...BASE, classifications: [] }).valid).toBe(false)
  })

  test("rejects an invalid executionType", () => {
    // @ts-expect-error deliberately invalid for the test
    expect(validateReportDefinitionInput({ ...BASE, executionType: "magic" }).valid).toBe(false)
  })

  test("requires dataGapNote when status is not 'built'", () => {
    expect(validateReportDefinitionInput({ ...BASE, status: "data_gap" }).valid).toBe(false)
    expect(validateReportDefinitionInput({ ...BASE, status: "data_gap", dataGapNote: "missing table X" }).valid).toBe(true)
  })

  test("validates periodicity shape when periodicity is set", () => {
    expect(validateReportDefinitionInput({ ...BASE, periodicity: "weekly" }).valid).toBe(false) // missing dayOfWeek
    expect(validateReportDefinitionInput({ ...BASE, periodicity: "weekly", periodicityConfig: { dayOfWeek: 1 } }).valid).toBe(true)
  })
})

// Priority 12 (OPEN-07 point 8 follow-on): report_definitions rows have no
// literal `domain` column -- executeReportDefinition()'s branch-enablement
// gate and getFullReportCatalog()'s merge both resolve domain through this
// one function, so its branching is worth locking down directly.
describe("deriveReportDomainFromClassifications", () => {
  test("compliance takes priority when present", () => {
    expect(deriveReportDomainFromClassifications(["compliance", "financial"])).toBe("compliance")
  })

  test("financial or revenue (without compliance) maps to ERP", () => {
    expect(deriveReportDomainFromClassifications(["financial"])).toBe("ERP")
    expect(deriveReportDomainFromClassifications(["revenue"])).toBe("ERP")
  })

  test("construction or project (without compliance/financial/revenue) maps to construction", () => {
    expect(deriveReportDomainFromClassifications(["construction"])).toBe("construction")
    expect(deriveReportDomainFromClassifications(["project"])).toBe("construction")
  })

  test("anything else falls through to custom", () => {
    expect(deriveReportDomainFromClassifications(["sales"])).toBe("custom")
    expect(deriveReportDomainFromClassifications([])).toBe("custom")
  })
})

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Reports & Dashboards" -- runAggregationFromConfig() now always
// returns a generated note; this is its pure derivation logic.
describe("buildAggregationNote", () => {
  test("describes a grouped count with no filter", () => {
    const note = buildAggregationNote({ tableKey: "crm_leads", groupByColumn: "status", aggregation: "count" })
    expect(note).toContain("Count of records")
    expect(note).toContain(`"crm_leads"`)
    expect(note).toContain(`grouped by "status"`)
  })

  test("describes an ungrouped sum", () => {
    const note = buildAggregationNote({ tableKey: "erp_sales_orders", aggregation: "sum", aggregationColumnKey: "grandTotal" })
    expect(note).toContain(`Sum of "grandTotal"`)
    expect(note).toContain("as a single ungrouped total")
  })

  test("includes an applied filter", () => {
    const note = buildAggregationNote({
      tableKey: "compliance_items", aggregation: "count",
      filterEquals: { columnKey: "status", value: "overdue" },
    })
    expect(note).toContain("filtered to rows where")
    expect(note).toContain("overdue")
  })

  test("includes a company scope when applied", () => {
    const note = buildAggregationNote({ tableKey: "erp_sales_orders", aggregation: "count" }, { companyId: "co_1" })
    expect(note).toContain("company = co_1")
  })
})

// SD-002 (Billing Due List, 2026-07-30): the one pure predicate the
// computeBillingDueList() formula filters through -- see that function's
// own header comment (report-engine-service.ts) for why the DB-touching
// query itself is left untested, matching this file's established
// pattern above.
describe("isBillingScheduleDue", () => {
  const ACTIVE_UNBILLED = { nextBillingDate: "2026-07-15", lastInvoiceId: null, isActive: true }

  test("due when active, unbilled, and nextBillingDate is in the past", () => {
    expect(isBillingScheduleDue(ACTIVE_UNBILLED, "2026-07-30")).toBe(true)
  })

  test("due when nextBillingDate exactly equals asOfDate", () => {
    expect(isBillingScheduleDue(ACTIVE_UNBILLED, "2026-07-15")).toBe(true)
  })

  test("not due when nextBillingDate is still in the future", () => {
    expect(isBillingScheduleDue(ACTIVE_UNBILLED, "2026-07-01")).toBe(false)
  })

  test("not due when already invoiced this cycle (lastInvoiceId set)", () => {
    expect(isBillingScheduleDue({ ...ACTIVE_UNBILLED, lastInvoiceId: "inv_123" }, "2026-07-30")).toBe(false)
  })

  test("not due when the schedule is inactive (e.g. a completed one-off milestone)", () => {
    expect(isBillingScheduleDue({ ...ACTIVE_UNBILLED, isActive: false }, "2026-07-30")).toBe(false)
  })
})

// SD-006 (Sales by Material / Service Type, 2026-07-30): the pure grouping/
// summing function salesByMaterialServiceTypeReport()'s formula filters
// through -- see that function's own header comment (report-engine-
// service.ts) for why the DB-touching query itself is left untested,
// matching this file's established pattern above (isBillingScheduleDue).
//
// Fixture: 3 distinct material/service types across 5 billing lines --
// "Joinery" (2 lines, one item-linked group member each), "Electrical"
// (2 lines, a different item group), and one line with NO item link at
// all (a free-text service description), which must be bucketed as
// "Unassigned" rather than dropped.
describe("aggregateSalesByMaterialServiceType", () => {
  const JOINERY_WARDROBE: SalesByServiceTypeLine = {
    itemCode: "JOIN-001", itemName: "Built-in Wardrobe (Joinery)", itemGroupName: "Joinery",
    description: "Built-in Wardrobe (Joinery)", quantity: 2, amount: 40000, standardBuyingRate: 12000,
  }
  const JOINERY_DOOR: SalesByServiceTypeLine = {
    itemCode: "JOIN-002", itemName: "Flush Door (Joinery)", itemGroupName: "Joinery",
    description: "Flush Door (Joinery)", quantity: 5, amount: 15000, standardBuyingRate: 2000,
  }
  const ELECTRICAL_WIRING: SalesByServiceTypeLine = {
    itemCode: "ELEC-001", itemName: "Concealed Wiring (Electrical)", itemGroupName: "Electrical",
    description: "Concealed Wiring (Electrical)", quantity: 1, amount: 25000, standardBuyingRate: 18000,
  }
  const ELECTRICAL_FIXTURES: SalesByServiceTypeLine = {
    itemCode: "ELEC-002", itemName: "Light Fixtures (Electrical)", itemGroupName: "Electrical",
    description: "Light Fixtures (Electrical)", quantity: 10, amount: 20000, standardBuyingRate: 1200,
  }
  // No erp_items link at all (item_id null on the invoice line) -- a
  // free-text service description, e.g. a one-off consulting line.
  const UNLINKED_CONSULTING: SalesByServiceTypeLine = {
    itemCode: null, itemName: null, itemGroupName: null,
    description: "Site Supervision Consulting (one-off)", quantity: 1, amount: 10000, standardBuyingRate: null,
  }
  const ALL_LINES = [JOINERY_WARDROBE, JOINERY_DOOR, ELECTRICAL_WIRING, ELECTRICAL_FIXTURES, UNLINKED_CONSULTING]

  test("groupBy 'item': one row per individual material/item, revenue summed correctly, unlinked line bucketed as UNASSIGNED", () => {
    const rows = aggregateSalesByMaterialServiceType(ALL_LINES, { groupBy: "item", includeCost: false })
    expect(rows).toHaveLength(5) // 4 distinct items + 1 unassigned bucket

    const wardrobe = rows.find((r) => r.code === "JOIN-001")!
    expect(wardrobe.totalNetRevenue).toBe(40000)
    expect(wardrobe.billingLineItems).toBe(1)
    expect(wardrobe.description).toBe("Built-in Wardrobe (Joinery)")

    const unassigned = rows.find((r) => r.code === "UNASSIGNED")!
    expect(unassigned.totalNetRevenue).toBe(10000)
    expect(unassigned.billingLineItems).toBe(1)
    expect(unassigned.description).toBe("Site Supervision Consulting (one-off)")

    expect(rows.every((r) => r.costOfGoodsSold === null && r.grossProfit === null && r.grossMarginPercent === null)).toBe(true)
  })

  test("groupBy 'group': 3 distinct material/service types (Joinery, Electrical, Unassigned), each correctly summed across its member lines", () => {
    const rows = aggregateSalesByMaterialServiceType(ALL_LINES, { groupBy: "group", includeCost: false })
    expect(rows).toHaveLength(3)

    const joinery = rows.find((r) => r.code === "Joinery")!
    expect(joinery.totalNetRevenue).toBe(55000) // 40000 + 15000
    expect(joinery.billingLineItems).toBe(2)

    const electrical = rows.find((r) => r.code === "Electrical")!
    expect(electrical.totalNetRevenue).toBe(45000) // 25000 + 20000
    expect(electrical.billingLineItems).toBe(2)

    const unassigned = rows.find((r) => r.code === "Unassigned")!
    expect(unassigned.totalNetRevenue).toBe(10000)
    expect(unassigned.billingLineItems).toBe(1)
    expect(unassigned.description).toBe("No item group / no item link (free-text service line)")

    const total = rows.reduce((sum, r) => sum + r.totalNetRevenue, 0)
    expect(total).toBe(110000) // no line silently dropped
  })

  test("includeCost: true computes Gross Profit/Gross Margin % per group from standard_buying_rate x quantity, and a $0-cost unassigned line doesn't crash the margin math", () => {
    const rows = aggregateSalesByMaterialServiceType(ALL_LINES, { groupBy: "group", includeCost: true })

    const joinery = rows.find((r) => r.code === "Joinery")!
    // cost = (2 * 12000) + (5 * 2000) = 24000 + 10000 = 34000; revenue 55000
    expect(joinery.costOfGoodsSold).toBe(34000)
    expect(joinery.grossProfit).toBe(21000) // 55000 - 34000
    expect(joinery.grossMarginPercent).toBeCloseTo((21000 / 55000) * 100, 2) // ~38.18%

    const electrical = rows.find((r) => r.code === "Electrical")!
    // cost = (1 * 18000) + (10 * 1200) = 18000 + 12000 = 30000; revenue 45000
    expect(electrical.costOfGoodsSold).toBe(30000)
    expect(electrical.grossProfit).toBe(15000)
    expect(electrical.grossMarginPercent).toBeCloseTo((15000 / 45000) * 100, 2) // ~33.33%

    // Unlinked line has no standardBuyingRate -- cost proxy is $0 for it,
    // which is disclosed (not hidden) via the caller's `note` field, but
    // must not throw or produce NaN/Infinity here.
    const unassigned = rows.find((r) => r.code === "Unassigned")!
    expect(unassigned.costOfGoodsSold).toBe(0)
    expect(unassigned.grossProfit).toBe(10000) // entirely "profit" since cost proxy is 0 -- the honest overstatement the note discloses
    expect(unassigned.grossMarginPercent).toBe(100)
  })

  test("a group with zero revenue (should not occur via real data, but the margin-% formula must not divide by zero) is guarded", () => {
    const zeroRevenueLine: SalesByServiceTypeLine = {
      itemCode: "ZERO-001", itemName: "Free Sample", itemGroupName: "Samples",
      description: "Free Sample", quantity: 1, amount: 0, standardBuyingRate: 500,
    }
    const rows = aggregateSalesByMaterialServiceType([zeroRevenueLine], { groupBy: "item", includeCost: true })
    expect(rows[0].totalNetRevenue).toBe(0)
    expect(rows[0].grossMarginPercent).toBe(0) // guarded, not NaN/Infinity
  })

  test("empty input returns an empty array, not an error", () => {
    expect(aggregateSalesByMaterialServiceType([], { groupBy: "item", includeCost: false })).toEqual([])
  })
})

// R67 D-02 (audit R-004/R-009). compliance's getProjectDashboard()/
// budgetVsActual() now return `budget` as `number | null` -- null meaning the
// project has NO budget rows at all, which is a different fact from a budget
// of zero. Three cost formulas here (CPI, Earned Value Analysis, Cost
// Overrun) each need a budget they can divide by and each used to test
// `budget <= 0` against a value that could not be null. usableBudget() is the
// single decision they now share; this block is what stops it drifting back
// into three separate inline comparisons.
describe("usableBudget", () => {
  test("no budget set returns null, so a formula reports 'no budget set' instead of dividing", () => {
    expect(usableBudget(null)).toBeNull()
  })

  test("a zero budget is equally undividable and returns null", () => {
    expect(usableBudget(0)).toBeNull()
  })

  test("a negative budget is not a budget either", () => {
    expect(usableBudget(-1)).toBeNull()
  })

  test("a real budget comes back unchanged, so CPI/EVA keep computing on the real figure", () => {
    expect(usableBudget(900000)).toBe(900000)
    expect(usableBudget(0.5)).toBe(0.5)
  })
})
