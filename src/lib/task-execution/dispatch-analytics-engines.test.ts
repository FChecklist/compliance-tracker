/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchAnalyticsEngines } from "./dispatch-analytics-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchAnalyticsEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchAnalyticsEngines("compliance_interest_calculator", {})).toBe(NOT_HANDLED)
  })

  test("trend_analysis_engine rejects a non-array values", async () => {
    expect(dispatchAnalyticsEngines("trend_analysis_engine", { values: "nope" })).rejects.toThrow("values must be an array of numbers")
  })

  test("forecast_baseline_engine rejects a method outside naive/moving_average", async () => {
    expect(dispatchAnalyticsEngines("forecast_baseline_engine", { historicalValues: [1, 2, 3], method: "linear" }))
      .rejects.toThrow("method must be naive or moving_average")
  })

  test("anomaly_detection_engine defaults to zscore and rejects an unknown method", async () => {
    const result = await dispatchAnalyticsEngines("anomaly_detection_engine", { values: [1, 2, 3, 100] })
    expect(result).toBeTruthy()
    expect(dispatchAnalyticsEngines("anomaly_detection_engine", { values: [1, 2], method: "percentile" })).rejects.toThrow("method must be zscore or iqr")
  })

  test("anomaly_detection_engine routes to a different underlying function for iqr vs zscore", async () => {
    const values = [1, 2, 3, 4, 5, 100]
    const zscore = await dispatchAnalyticsEngines("anomaly_detection_engine", { values, method: "zscore" })
    const iqr = await dispatchAnalyticsEngines("anomaly_detection_engine", { values, method: "iqr" })
    expect(zscore).toBeTruthy()
    expect(iqr).toBeTruthy()
  })

  test("correlation_calculator rejects when either values array is missing", async () => {
    expect(dispatchAnalyticsEngines("correlation_calculator", { xValues: [1, 2], yValues: "nope" })).rejects.toThrow("xValues and yValues must both be arrays")
  })
})
