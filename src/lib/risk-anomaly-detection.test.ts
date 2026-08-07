/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  evaluateBulkExportAnomaly,
  evaluateAfterHoursHighImpactAction,
  evaluateRepeatedFailedAuth,
  evaluateDuplicatePayment,
  evaluateRoundNumberThresholdAvoidance,
  isAfterHours,
  BULK_EXPORT_ROW_THRESHOLD,
  FAILED_AUTH_THRESHOLD,
} from "./risk-anomaly-detection"

describe("evaluateBulkExportAnomaly", () => {
  test("does not flag an export at or below the threshold", () => {
    expect(evaluateBulkExportAnomaly(BULK_EXPORT_ROW_THRESHOLD).anomaly).toBe(false)
    expect(evaluateBulkExportAnomaly(10).anomaly).toBe(false)
  })

  test("flags an export over the threshold, at medium severity", () => {
    const result = evaluateBulkExportAnomaly(BULK_EXPORT_ROW_THRESHOLD + 1)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) {
      expect(result.eventType).toBe("bulk_export")
      expect(result.severity).toBe("medium")
    }
  })

  test("escalates severity to high for a very large export", () => {
    const result = evaluateBulkExportAnomaly(BULK_EXPORT_ROW_THRESHOLD * 6)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.severity).toBe("high")
  })
})

describe("isAfterHours", () => {
  test("a weekday daytime hour is within business hours", () => {
    // Wed 2026-07-15 14:00 local
    expect(isAfterHours(new Date(2026, 6, 15, 14, 0))).toBe(false)
  })

  test("a weekday before opening hour is after-hours", () => {
    expect(isAfterHours(new Date(2026, 6, 15, 5, 0))).toBe(true)
  })

  test("a weekday after closing hour is after-hours", () => {
    expect(isAfterHours(new Date(2026, 6, 15, 22, 0))).toBe(true)
  })

  test("any hour on a weekend is after-hours", () => {
    // 2026-07-18 is a Saturday
    expect(isAfterHours(new Date(2026, 6, 18, 12, 0))).toBe(true)
  })
})

describe("evaluateAfterHoursHighImpactAction", () => {
  test("no anomaly during business hours", () => {
    expect(evaluateAfterHoursHighImpactAction("payment.approved", new Date(2026, 6, 15, 14, 0)).anomaly).toBe(false)
  })

  test("flags a high-impact action taken after hours, at high severity", () => {
    const result = evaluateAfterHoursHighImpactAction("payment.approved", new Date(2026, 6, 15, 23, 0))
    expect(result.anomaly).toBe(true)
    if (result.anomaly) {
      expect(result.eventType).toBe("after_hours_high_impact")
      expect(result.severity).toBe("high")
    }
  })
})

describe("evaluateRepeatedFailedAuth", () => {
  test("does not flag a count below the threshold", () => {
    expect(evaluateRepeatedFailedAuth(FAILED_AUTH_THRESHOLD - 1).anomaly).toBe(false)
  })

  test("flags a count at the threshold, at high severity", () => {
    const result = evaluateRepeatedFailedAuth(FAILED_AUTH_THRESHOLD)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.severity).toBe("high")
  })

  test("escalates to critical severity well past the threshold", () => {
    const result = evaluateRepeatedFailedAuth(FAILED_AUTH_THRESHOLD * 2)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.severity).toBe("critical")
  })
})

describe("evaluateDuplicatePayment", () => {
  test("no anomaly when there is no recent same-amount payment to the same party", () => {
    const result = evaluateDuplicatePayment({ amount: 1000, postingDate: "2026-07-15" }, [{ amount: 500, postingDate: "2026-07-15" }])
    expect(result.anomaly).toBe(false)
  })

  test("flags a same-amount payment to the same party within the window", () => {
    const result = evaluateDuplicatePayment({ amount: 1000, postingDate: "2026-07-15" }, [{ amount: 1000, postingDate: "2026-07-14" }])
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.eventType).toBe("duplicate_payment")
  })

  test("does not flag a same-amount payment outside the window", () => {
    const result = evaluateDuplicatePayment({ amount: 1000, postingDate: "2026-07-15" }, [{ amount: 1000, postingDate: "2026-07-01" }], 3)
    expect(result.anomaly).toBe(false)
  })
})

describe("evaluateRoundNumberThresholdAvoidance", () => {
  test("no anomaly for a normal, non-round amount well under the threshold", () => {
    expect(evaluateRoundNumberThresholdAvoidance(12345, 100_000).anomaly).toBe(false)
  })

  test("flags threshold-avoidance when the amount sits just under the approval threshold", () => {
    const result = evaluateRoundNumberThresholdAvoidance(95_000, 100_000)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.eventType).toBe("threshold_avoidance")
  })

  test("flags a suspiciously round large amount at low severity", () => {
    const result = evaluateRoundNumberThresholdAvoidance(60_000, 500_000)
    expect(result.anomaly).toBe(true)
    if (result.anomaly) expect(result.severity).toBe("low")
  })

  test("does not flag a round number below the minimum size", () => {
    expect(evaluateRoundNumberThresholdAvoidance(10_000, 500_000).anomaly).toBe(false)
  })
})
