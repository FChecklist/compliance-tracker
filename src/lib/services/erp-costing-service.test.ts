// CO-006 (Statistical Key Figure Report): tests the pure aggregation core
// (computeStatisticalKeyFigureReport) directly, matching this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (see erp-fixed-assets-service.test.ts's own header note).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeStatisticalKeyFigureReport, type StatKeyFigurePostingRow } from "./erp-costing-service"

const HEADCOUNT = { id: "skf-headcount", name: "Number of Employees", unitOfMeasure: "EA" }
const SQM = { id: "skf-sqm", name: "Square Meters Occupied", unitOfMeasure: "SQM" }
const TYPES = [HEADCOUNT, SQM]

const ADMIN = { id: "cc-admin", name: "Administration" }
const PRODUCTION = { id: "cc-production", name: "Production" }
const SALES = { id: "cc-sales", name: "Sales" }
const COST_CENTERS = [ADMIN, PRODUCTION, SALES]

function posting(overrides: Partial<StatKeyFigurePostingRow> = {}): StatKeyFigurePostingRow {
  return { statKeyFigureTypeId: HEADCOUNT.id, costCenterId: ADMIN.id, version: "actual", value: 0, ...overrides }
}

describe("computeStatisticalKeyFigureReport", () => {
  test("real 3-cost-center, 2-SKF-type example: per-cost-center actual values sum correctly across multiple postings", () => {
    // Hand computation: Administration's headcount = 5 (one posting) + 3
    // (a later correction posting in the same period) = 8, matching SAP's
    // own additive KB21N posting behaviour (never a single overwritten
    // value). Production headcount = 40 (single posting). Sales has no
    // headcount postings at all -- it should not appear in the headcount
    // rows, only in its own square-meters row.
    const postings: StatKeyFigurePostingRow[] = [
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 5 }),
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 3 }),
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 40 }),
      posting({ costCenterId: SALES.id, statKeyFigureTypeId: SQM.id, version: "actual", value: 120 }),
    ]

    const rows = computeStatisticalKeyFigureReport(TYPES, COST_CENTERS, postings)

    expect(rows.length).toBe(3) // Admin/headcount, Production/headcount, Sales/sqm -- not 6 (no cross-product of every type x every cost center)

    const adminHeadcount = rows.find((r) => r.costCenterId === ADMIN.id && r.statKeyFigureTypeId === HEADCOUNT.id)
    expect(adminHeadcount).toBeDefined()
    expect(adminHeadcount!.actualValue).toBe(8)
    expect(adminHeadcount!.costCenterName).toBe("Administration")
    expect(adminHeadcount!.unitOfMeasure).toBe("EA")

    const productionHeadcount = rows.find((r) => r.costCenterId === PRODUCTION.id && r.statKeyFigureTypeId === HEADCOUNT.id)
    expect(productionHeadcount!.actualValue).toBe(40)

    const salesSqm = rows.find((r) => r.costCenterId === SALES.id && r.statKeyFigureTypeId === SQM.id)
    expect(salesSqm!.actualValue).toBe(120)
    expect(salesSqm!.unitOfMeasure).toBe("SQM")

    // No plan postings supplied at all -- plan should read 0, not undefined/NaN, and variance = actual - plan
    expect(adminHeadcount!.planValue).toBe(0)
    expect(adminHeadcount!.variance).toBe(8)
  })

  test("plan vs actual variance: a real over-budget headcount case", () => {
    // Hand computation: plan = 10, actual = 5 + 3 + 4 = 12 -> variance = +2 (over plan)
    const postings: StatKeyFigurePostingRow[] = [
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "plan", value: 10 }),
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 5 }),
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 3 }),
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 4 }),
    ]

    const [row] = computeStatisticalKeyFigureReport(TYPES, COST_CENTERS, postings)

    expect(row.planValue).toBe(10)
    expect(row.actualValue).toBe(12)
    expect(row.variance).toBe(2)
  })

  test("a posting referencing a cost center or SKF type not in the (filtered) lookup lists is skipped defensively, not thrown", () => {
    const postings: StatKeyFigurePostingRow[] = [
      posting({ costCenterId: "cc-does-not-exist", statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 999 }),
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: "skf-does-not-exist", version: "actual", value: 999 }),
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 7 }),
    ]

    const rows = computeStatisticalKeyFigureReport(TYPES, COST_CENTERS, postings)

    expect(rows.length).toBe(1)
    expect(rows[0].actualValue).toBe(7)
  })

  test("empty postings produce an empty report, not an error", () => {
    expect(computeStatisticalKeyFigureReport(TYPES, COST_CENTERS, [])).toEqual([])
  })

  test("rows are sorted by cost center name then SKF name, for stable display order", () => {
    const postings: StatKeyFigurePostingRow[] = [
      posting({ costCenterId: SALES.id, statKeyFigureTypeId: SQM.id, version: "actual", value: 50 }),
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: SQM.id, version: "actual", value: 30 }),
      posting({ costCenterId: ADMIN.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 8 }),
      posting({ costCenterId: PRODUCTION.id, statKeyFigureTypeId: HEADCOUNT.id, version: "actual", value: 40 }),
    ]

    const rows = computeStatisticalKeyFigureReport(TYPES, COST_CENTERS, postings)

    expect(rows.map((r) => `${r.costCenterName}/${r.statKeyFigureName}`)).toEqual([
      "Administration/Number of Employees",
      "Administration/Square Meters Occupied",
      "Production/Number of Employees",
      "Sales/Square Meters Occupied",
    ])
  })
})
