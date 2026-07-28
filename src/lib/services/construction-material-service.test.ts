// Wave 174: tests the pure material cost-report aggregation
// (aggregateMaterialCostReport) against a realistic multi-entry dataset --
// no withTenantContext/live DB, matching this repo's established pattern
// (see erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { aggregateMaterialCostReport } from "./construction-material-service"

describe("aggregateMaterialCostReport", () => {
  const materials = [
    { id: "mat-cement", spec: "OPC 53 Grade Cement", unit: "bag" },
    { id: "mat-steel", spec: "TMT Bar 12mm", unit: "kg" },
    { id: "mat-unused", spec: "Never delivered", unit: "nos" },
  ]

  test("sums quantity and cost across multiple inbound entries per material, computes a correct weighted average unit cost", () => {
    const inbound = [
      { materialId: "mat-cement", quantityReceived: "100", totalCost: "35000" }, // 350/bag
      { materialId: "mat-cement", quantityReceived: "50", totalCost: "18000" },  // 360/bag
      { materialId: "mat-steel", quantityReceived: "500", totalCost: "27500" },  // 55/kg
      { materialId: "mat-steel", quantityReceived: "200", totalCost: "11200" },  // 56/kg
    ]

    const rows = aggregateMaterialCostReport(materials, inbound)

    const cement = rows.find((r) => r.materialId === "mat-cement")!
    expect(cement.totalQuantityReceived).toBeCloseTo(150)
    expect(cement.totalCost).toBeCloseTo(53000)
    expect(cement.averageUnitCost).toBeCloseTo(53000 / 150)

    const steel = rows.find((r) => r.materialId === "mat-steel")!
    expect(steel.totalQuantityReceived).toBeCloseTo(700)
    expect(steel.totalCost).toBeCloseTo(38700)
    expect(steel.averageUnitCost).toBeCloseTo(38700 / 700)
  })

  test("a material with zero inbound entries is omitted from the report, not shown as a zero row", () => {
    const rows = aggregateMaterialCostReport(materials, [{ materialId: "mat-cement", quantityReceived: "10", totalCost: "3600" }])
    expect(rows).toHaveLength(1)
    expect(rows.find((r) => r.materialId === "mat-unused")).toBeUndefined()
  })

  test("empty inbound list produces an empty report", () => {
    expect(aggregateMaterialCostReport(materials, [])).toEqual([])
  })
})
