/// <reference types="bun-types" />
// R67 E-05 (R-103) -- the Material Cost Report's arithmetic.
//
// Why a pure test and not a DB one: aggregateMaterialCostReport is the half a
// QS checks by hand. He reads the Grand Total, adds the column himself, and
// stops trusting every other figure on the screen if they differ -- which is
// the defect R-103 records. The identity "sum(rows.totalCost) === totals.cost"
// is therefore asserted directly, in both groupings, rather than inferred.
//
// This file follows the same DB-free convention as
// construction-reports-service.test.ts (computeEarnedValue,
// aggregateDesignerTimesheetCosts): the SQL half of getMaterialCostReport --
// the date window, the voided-receipt exclusion and the (material, vendor)
// grouping -- is asserted on the source shape below, because a unit test
// cannot open a real tenant-scoped pool.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  aggregateMaterialCostReport,
  MIXED_MATERIALS_LABEL,
  MIXED_VENDORS_LABEL,
  NO_VENDOR_KEY,
  NO_VENDOR_LABEL,
  type MaterialReceiptGroup,
} from "./construction-materials-service"

const MATERIALS = new Map([
  ["m-cement", { name: "OPC Cement 53 Grade", spec: "53 Grade", unit: "bag", unitCost: "24.00" }],
  ["m-steel", { name: "TMT Steel 12mm", spec: "Fe500D", unit: "kg", unitCost: "3.50" }],
])
const VENDORS = new Map([
  ["v-alpha", "Alpha Trading LLC"],
  ["v-beta", "Beta Building Materials"],
])

const PARAMS_MATERIAL = { projectId: "p1", from: "2026-01-01", to: "2026-09-02", groupBy: "material" as const }
const PARAMS_VENDOR = { ...PARAMS_MATERIAL, groupBy: "vendor" as const }

// 200 bags of cement from two vendors, 1,000 kg of steel from one.
const GROUPS: MaterialReceiptGroup[] = [
  { materialId: "m-cement", vendorId: "v-alpha", quantity: 120, cost: 3000 },
  { materialId: "m-cement", vendorId: "v-beta", quantity: 80, cost: 2000 },
  { materialId: "m-steel", vendorId: "v-alpha", quantity: 1000, cost: 3600 },
]

describe("aggregateMaterialCostReport: grouped by material", () => {
  const report = aggregateMaterialCostReport(GROUPS, MATERIALS, VENDORS, PARAMS_MATERIAL)

  test("one row per material, costliest first", () => {
    expect(report.rows.map((r) => r.key)).toEqual(["m-cement", "m-steel"])
  })

  test("THE identity: the rows on screen sum to the Grand Total", () => {
    expect(report.rows.reduce((s, r) => s + r.totalCost, 0)).toBe(report.totals.cost)
    expect(report.totals.cost).toBe(8600)
  })

  test("average unit cost is the row's own money over the row's own quantity", () => {
    const cement = report.rows.find((r) => r.key === "m-cement")!
    expect(cement.totalQuantityReceived).toBe(200)
    expect(cement.totalCost).toBe(5000)
    expect(cement.averageUnitCost).toBe(25)
  })

  test("variance is what was actually paid less the master's own unit cost -- the point of the column", () => {
    const cement = report.rows.find((r) => r.key === "m-cement")!
    expect(cement.masterUnitCost).toBe(24)
    expect(cement.variance).toBe(1) // paid AED 25/bag against a master of AED 24
    const steel = report.rows.find((r) => r.key === "m-steel")!
    expect(steel.averageUnitCost).toBe(3.6)
    expect(steel.variance).toBe(0.1)
  })

  test("a material bought from more than one vendor says so in words, not a blank cell", () => {
    expect(report.rows.find((r) => r.key === "m-cement")!.vendorName).toBe(MIXED_VENDORS_LABEL)
    expect(report.rows.find((r) => r.key === "m-steel")!.vendorName).toBe("Alpha Trading LLC")
  })

  test("the parameters come back with the numbers, so the bar and the table cannot disagree", () => {
    expect(report.params).toEqual(PARAMS_MATERIAL)
  })
})

describe("aggregateMaterialCostReport: grouped by vendor", () => {
  const report = aggregateMaterialCostReport(GROUPS, MATERIALS, VENDORS, PARAMS_VENDOR)

  test("one row per vendor, and the SAME grand total as the material grouping", () => {
    expect(report.rows.map((r) => r.key).sort()).toEqual(["v-alpha", "v-beta"])
    expect(report.totals.cost).toBe(8600)
    expect(report.rows.reduce((s, r) => s + r.totalCost, 0)).toBe(report.totals.cost)
  })

  test("a vendor spanning two materials names neither one falsely, and states no unit it cannot state", () => {
    const alpha = report.rows.find((r) => r.key === "v-alpha")!
    expect(alpha.name).toBe(MIXED_MATERIALS_LABEL)
    expect(alpha.unit).toBeNull()
    // Cement bags and steel kilos cannot share a master unit cost, so there is
    // nothing honest to compare against.
    expect(alpha.masterUnitCost).toBeNull()
    expect(alpha.variance).toBeNull()
  })

  test("a vendor with only one material still shows that material and its variance", () => {
    const beta = report.rows.find((r) => r.key === "v-beta")!
    expect(beta.name).toBe("OPC Cement 53 Grade")
    expect(beta.unit).toBe("bag")
    expect(beta.masterUnitCost).toBe(24)
    expect(beta.averageUnitCost).toBe(25)
    expect(beta.variance).toBe(1)
  })

  test("receipts with no vendor recorded get their own named bucket, never silently merged into a real vendor", () => {
    const withOrphan = aggregateMaterialCostReport(
      [...GROUPS, { materialId: "m-cement", vendorId: null, quantity: 10, cost: 260 }],
      MATERIALS,
      VENDORS,
      PARAMS_VENDOR
    )
    const orphan = withOrphan.rows.find((r) => r.key === NO_VENDOR_KEY)!
    expect(orphan.vendorName).toBe(NO_VENDOR_LABEL)
    expect(orphan.totalCost).toBe(260)
    expect(withOrphan.totals.cost).toBe(8860)
  })
})

describe("aggregateMaterialCostReport: degenerate inputs", () => {
  test("no receipts in the window is an empty report with a real zero total, never a missing one", () => {
    const report = aggregateMaterialCostReport([], MATERIALS, VENDORS, PARAMS_MATERIAL)
    expect(report.rows).toEqual([])
    expect(report.totals).toEqual({ quantity: 0, cost: 0 })
  })

  test("a zero-quantity group does not divide by zero", () => {
    const report = aggregateMaterialCostReport(
      [{ materialId: "m-cement", vendorId: "v-alpha", quantity: 0, cost: 0 }],
      MATERIALS,
      VENDORS,
      PARAMS_MATERIAL
    )
    expect(report.rows[0].averageUnitCost).toBe(0)
    expect(Number.isFinite(report.rows[0].averageUnitCost)).toBe(true)
  })

  test("a material with no master row still reports its money, under its id, with no fabricated master cost", () => {
    const report = aggregateMaterialCostReport(
      [{ materialId: "m-gone", vendorId: "v-alpha", quantity: 5, cost: 50 }],
      MATERIALS,
      VENDORS,
      PARAMS_MATERIAL
    )
    expect(report.rows[0].name).toBe("m-gone")
    expect(report.rows[0].masterUnitCost).toBeNull()
    expect(report.rows[0].variance).toBeNull()
    expect(report.rows[0].totalCost).toBe(50)
  })
})

// The SQL half. These are honest about their limit: they pin the exact
// clauses R-103 and WS-I item I-02 require, not every possible way to write a
// wrong query.
describe("getMaterialCostReport: the query itself", () => {
  const SOURCE = readFileSync(path.join(import.meta.dir, "construction-materials-service.ts"), "utf8")
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const start = CODE.indexOf("export async function getMaterialCostReport(")
  const next = CODE.indexOf("\nexport ", start + 1)
  const body = CODE.slice(start, next === -1 ? undefined : next)

  test("VOIDED receipts are excluded -- a cancelled goods receipt is not cost", () => {
    expect(body).toMatch(/isNull\(constructionMaterialReceipts\.voidedAt\)/)
  })

  test("the date window is applied in SQL, so the rows and the total describe one set", () => {
    expect(body).toMatch(/gte\(constructionMaterialReceipts\.receivedDate, from\)/)
    expect(body).toMatch(/lte\(constructionMaterialReceipts\.receivedDate, to\)/)
  })

  test("ONE grouped read at (material, vendor) grain -- both groupings fold from it, no re-query", () => {
    expect(body).toMatch(/\.groupBy\(constructionMaterialReceipts\.materialId, constructionMaterialReceipts\.vendorId\)/)
    expect(body.match(/\.groupBy\(/g)?.length).toBe(1)
  })

  test("vendor names are looked up once for the whole report, never per row", () => {
    expect(body).toMatch(/inArray\(erpSuppliers\.id, vendorIds\)/)
  })

  test("only ONE withTenantContext -- no nested transaction on the shared five-connection pool", () => {
    expect(body.match(/withTenantContext\(/g)?.length).toBe(1)
  })
})
