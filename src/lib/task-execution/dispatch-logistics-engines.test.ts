/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchLogisticsEngines } from "./dispatch-logistics-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchLogisticsEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchLogisticsEngines("trend_analysis_engine", {})).toBe(NOT_HANDLED)
  })

  test("route_optimization_engine rejects a non-array points", async () => {
    expect(dispatchLogisticsEngines("route_optimization_engine", { points: "nope" })).rejects.toThrow("points must be an array")
  })

  test("vehicle_utilization_engine and container_utilization_engine dispatch to distinct pure formulas", async () => {
    expect(await dispatchLogisticsEngines("vehicle_utilization_engine", { loadedWeightKg: 50, vehicleCapacityKg: 100 })).toEqual({ utilizationPercent: 50 })
    expect(await dispatchLogisticsEngines("container_utilization_engine", { loadedVolumeCbm: 25, containerCapacityCbm: 100 })).toEqual({ utilizationPercent: 25 })
  })

  test("shipment_cost_calculator only adds optional components when provided", async () => {
    const minimal = await dispatchLogisticsEngines("shipment_cost_calculator", { freight: 100 }) as { shipmentCost: number }
    const withExtras = await dispatchLogisticsEngines("shipment_cost_calculator", { freight: 100, handling: 10, insurance: 5, customs: 2 }) as { shipmentCost: number }
    expect(minimal.shipmentCost).toBe(100)
    expect(withExtras.shipmentCost).toBe(117)
  })
})
