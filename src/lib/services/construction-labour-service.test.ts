// Wave 174: tests the pure manpower cost-report aggregation
// (buildManpowerCostReport) against a realistic multi-entry dataset -- no
// withTenantContext/live DB, matching this repo's established pattern (see
// erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildManpowerCostReport } from "./construction-labour-service"

describe("buildManpowerCostReport", () => {
  const roster = [
    { id: "w-1", name: "Ramesh Kumar", trade: "Mason", dailyRate: "800", vendorId: "vendor-1" },
    { id: "w-2", name: "Suresh Yadav", trade: "Mason", dailyRate: "750", vendorId: null },
    { id: "w-3", name: "Priya Singh", trade: "Electrician", dailyRate: "900", vendorId: "vendor-2" },
  ]
  const vendorNamesById = { "vendor-1": "BuildRight Contractors", "vendor-2": "PowerLine Electricals" }

  const attendance = [
    { rosterId: "w-1", attendanceDate: "2026-07-01", status: "present", dailyCost: "800" },
    { rosterId: "w-1", attendanceDate: "2026-07-02", status: "half_day", dailyCost: "400" },
    { rosterId: "w-2", attendanceDate: "2026-07-01", status: "present", dailyCost: "750" },
    { rosterId: "w-3", attendanceDate: "2026-07-01", status: "absent", dailyCost: "0" },
    { rosterId: "w-3", attendanceDate: "2026-07-02", status: "present", dailyCost: "900" },
  ]

  test("every attendance entry joins to its worker's Company (vendor) and Salary (daily rate), matching the S.No/ID/Name/Company/Salary spec", () => {
    const { rows } = buildManpowerCostReport(roster, attendance, vendorNamesById)
    expect(rows).toHaveLength(5)

    const ramesh0701 = rows.find((r) => r.id === "w-1" && r.attendanceDate === "2026-07-01")!
    expect(ramesh0701.name).toBe("Ramesh Kumar")
    expect(ramesh0701.company).toBe("BuildRight Contractors")
    expect(ramesh0701.salary).toBe(800)

    const suresh = rows.find((r) => r.id === "w-2")!
    expect(suresh.company).toBe("In-house") // no vendorId
  })

  test("filtering by trade only returns that trade's entries -- daily rollup still sums correctly for the filtered set", () => {
    const { rows, dailyRollup } = buildManpowerCostReport(roster, attendance, vendorNamesById, { trade: "Mason" })
    expect(rows).toHaveLength(3) // w-1 x2 + w-2 x1, w-3 (Electrician) excluded
    expect(rows.every((r) => r.trade === "Mason")).toBe(true)

    const day1 = dailyRollup.find((d) => d.date === "2026-07-01")!
    expect(day1.totalCost).toBeCloseTo(800 + 750) // w-1 present + w-2 present, w-3 excluded by trade filter
    expect(day1.workerCount).toBe(2)

    const day2 = dailyRollup.find((d) => d.date === "2026-07-02")!
    expect(day2.totalCost).toBeCloseTo(400) // only w-1 half-day
    expect(day2.workerCount).toBe(1)
  })

  test("daily rollup across all trades sums every worker's cost per date, including a 0-cost absent entry", () => {
    const { dailyRollup } = buildManpowerCostReport(roster, attendance, vendorNamesById)
    const day1 = dailyRollup.find((d) => d.date === "2026-07-01")!
    expect(day1.totalCost).toBeCloseTo(800 + 750 + 0) // w-1 + w-2 + w-3(absent)
    expect(day1.workerCount).toBe(3)

    const day2 = dailyRollup.find((d) => d.date === "2026-07-02")!
    expect(day2.totalCost).toBeCloseTo(400 + 900) // w-1 half-day + w-3 present
    expect(day2.workerCount).toBe(2)
  })

  test("an attendance entry for a roster id that no longer resolves is dropped, not thrown", () => {
    const { rows } = buildManpowerCostReport(roster, [{ rosterId: "ghost", attendanceDate: "2026-07-01", status: "present", dailyCost: "500" }], vendorNamesById)
    expect(rows).toHaveLength(0)
  })
})
