/// <reference types="bun-types" />
// PLATFORM_STRATEGY.md section 29.3, Phase 0. Mirrors audit-protocol.test.ts's
// structure: exercises the pure validation function directly, no DB/mocking
// required -- consistent with this repo's established "test the pure
// predicate" convention (see approval-workflow-service.test.ts's header).
import { describe, expect, test } from "bun:test"
import { validateMonitorReportFields, type MonitorReportFields } from "./monitor-protocol"

const OK_REPORT: MonitorReportFields = {
  status: "ok",
  worker: "approval_decision_timeliness_monitor's subject: ApprovalRequest cm3xabc9f",
  protocol: "approval-decision-timeliness: resolvedAt - createdAt <= maxExecutionTimeMs",
  confidence: 100,
  action: "none",
}

const ESCALATE_REPORT: MonitorReportFields = {
  ...OK_REPORT,
  status: "escalate",
  action: "escalate",
}

describe("validateMonitorReportFields -- 29.3 Phase 0 MonitorReportFields gate", () => {
  test("passes a complete 'ok' report", () => {
    expect(validateMonitorReportFields(OK_REPORT)).toEqual({ valid: true })
  })

  test("passes a complete 'escalate' report", () => {
    expect(validateMonitorReportFields(ESCALATE_REPORT)).toEqual({ valid: true })
  })

  test("rejects a missing status", () => {
    const { status: _drop, ...rest } = OK_REPORT
    const result = validateMonitorReportFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Status is missing")
  })

  test("rejects an invalid status value", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, status: "maybe" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Status")
  })

  test("rejects a missing worker", () => {
    const { worker: _drop, ...rest } = OK_REPORT
    const result = validateMonitorReportFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Worker is missing")
  })

  test("rejects a placeholder protocol value", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, protocol: "TBD" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects a missing confidence", () => {
    const { confidence: _drop, ...rest } = OK_REPORT
    const result = validateMonitorReportFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Confidence is missing")
  })

  test("rejects an out-of-range confidence", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, confidence: 101 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("out of range")
  })

  test("rejects a negative confidence", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, confidence: -1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("out of range")
  })

  test("rejects an invalid action value", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, action: "shrug" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Action")
  })

  test("rejects vague/ambiguous language in the protocol field", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, protocol: "checked it and handled edge cases as needed" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("vague")
  })

  test("status/action enum values are case-insensitive", () => {
    const result = validateMonitorReportFields({ ...OK_REPORT, status: "OK", action: "NONE" })
    expect(result).toEqual({ valid: true })
  })
})
