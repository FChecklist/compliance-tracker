/// <reference types="bun-types" />
// Gap closure (VERIDIAN Review Framework, AI Capability Registry: "registry
// coverage/backfill completeness not independently measured"). Tests only
// the pure coveragePercent math -- measureCapabilityCoverage()/
// backfillCapabilityIndex() themselves touch the DB and are deliberately
// left untested here, matching this repo's established pattern (see
// capability-registry-service.test.ts's own note on this).
import { describe, expect, test } from "bun:test"
import { toCoverage } from "./capability-backfill-service"

describe("toCoverage", () => {
  test("100% when everything eligible is indexed", () => {
    expect(toCoverage(10, 10)).toEqual({ total: 10, indexed: 10, coveragePercent: 100 })
  })

  test("0% when nothing is indexed", () => {
    expect(toCoverage(10, 0)).toEqual({ total: 10, indexed: 0, coveragePercent: 0 })
  })

  test("an empty registry reports 100% rather than NaN/0-of-0", () => {
    expect(toCoverage(0, 0)).toEqual({ total: 0, indexed: 0, coveragePercent: 100 })
  })

  test("rounds to one decimal place", () => {
    expect(toCoverage(3, 1).coveragePercent).toBeCloseTo(33.3, 5)
    expect(toCoverage(7, 5).coveragePercent).toBeCloseTo(71.4, 5)
  })
})
