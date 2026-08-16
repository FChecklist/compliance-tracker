/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyAuditCadence, AUDIT_LEVEL_DEFINITIONS } from "./audit-cadence"

describe("AUDIT_LEVEL_DEFINITIONS -- source-of-truth transcription", () => {
  test("names all 7 levels, in order", () => {
    expect(AUDIT_LEVEL_DEFINITIONS.map((d) => d.level)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7"])
  })

  test("only L1 and L4 are marked per-task-triggered", () => {
    const perTask = AUDIT_LEVEL_DEFINITIONS.filter((d) => d.perTaskTriggered).map((d) => d.level)
    expect(perTask).toEqual(["L1", "L4"])
  })
})

describe("classifyAuditCadence -- Constitution audit cadence table, area 9 item 1", () => {
  test("no risk level, no confidence band: nothing applies", () => {
    const result = classifyAuditCadence({})
    expect(result.levels).toEqual([])
    expect(result.requiresRealTimeAudit).toBe(false)
    expect(result.requiresExecutiveEscalation).toBe(false)
    expect(result.reasons).toEqual([])
  })

  test("auto_proceed confidence band alone does not trigger L1", () => {
    const result = classifyAuditCadence({ confidenceBand: "auto_proceed" })
    expect(result.requiresRealTimeAudit).toBe(false)
    expect(result.levels).toEqual([])
  })

  test("self_review_required confidence band triggers L1", () => {
    const result = classifyAuditCadence({ confidenceBand: "self_review_required" })
    expect(result.requiresRealTimeAudit).toBe(true)
    expect(result.levels).toEqual(["L1"])
  })

  test("peer_review_required confidence band triggers L1", () => {
    const result = classifyAuditCadence({ confidenceBand: "peer_review_required" })
    expect(result.requiresRealTimeAudit).toBe(true)
    expect(result.levels).toEqual(["L1"])
  })

  test("escalation_required confidence band triggers L1", () => {
    const result = classifyAuditCadence({ confidenceBand: "escalation_required" })
    expect(result.requiresRealTimeAudit).toBe(true)
    expect(result.levels).toEqual(["L1"])
  })

  test("low risk level alone triggers nothing", () => {
    const result = classifyAuditCadence({ riskLevel: "low" })
    expect(result.levels).toEqual([])
    expect(result.requiresRealTimeAudit).toBe(false)
    expect(result.requiresExecutiveEscalation).toBe(false)
  })

  test("medium risk level alone triggers nothing", () => {
    const result = classifyAuditCadence({ riskLevel: "medium" })
    expect(result.levels).toEqual([])
  })

  test("high risk level triggers L4 executive escalation but not L1", () => {
    const result = classifyAuditCadence({ riskLevel: "high" })
    expect(result.requiresExecutiveEscalation).toBe(true)
    expect(result.requiresRealTimeAudit).toBe(false)
    expect(result.levels).toEqual(["L4"])
  })

  test("critical risk level triggers both L1 and L4, regardless of confidence", () => {
    const result = classifyAuditCadence({ riskLevel: "critical", confidenceBand: "auto_proceed" })
    expect(result.requiresRealTimeAudit).toBe(true)
    expect(result.requiresExecutiveEscalation).toBe(true)
    expect(result.levels).toEqual(["L1", "L4"])
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test("critical risk + low confidence band combine into one L1/L4 result, not duplicated levels", () => {
    const result = classifyAuditCadence({ riskLevel: "critical", confidenceBand: "escalation_required" })
    expect(result.levels).toEqual(["L1", "L4"])
    expect(result.reasons.length).toBe(2)
  })

  test("high risk + low confidence band: L1 from confidence, L4 from risk", () => {
    const result = classifyAuditCadence({ riskLevel: "high", confidenceBand: "peer_review_required" })
    expect(result.levels).toEqual(["L1", "L4"])
    expect(result.requiresRealTimeAudit).toBe(true)
    expect(result.requiresExecutiveEscalation).toBe(true)
  })

  test("levels are always returned in canonical L1..L7 order", () => {
    const result = classifyAuditCadence({ riskLevel: "critical", confidenceBand: "escalation_required" })
    expect(result.levels).toEqual(["L1", "L4"])
  })
})
