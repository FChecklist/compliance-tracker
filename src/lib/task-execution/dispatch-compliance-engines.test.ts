/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchComplianceEngines } from "./dispatch-compliance-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchComplianceEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchComplianceEngines("tool_selector_engine", {})).toBe(NOT_HANDLED)
  })

  test("filing_eligibility_engine rejects a non-array preconditions", async () => {
    expect(dispatchComplianceEngines("filing_eligibility_engine", { preconditions: "nope" })).rejects.toThrow("preconditions must be an array")
  })

  test("document_completeness_checker rejects when either document list is missing", async () => {
    expect(dispatchComplianceEngines("document_completeness_checker", { requiredDocuments: [], filedDocuments: "nope" }))
      .rejects.toThrow("requiredDocuments and filedDocuments must both be arrays")
  })

  test("compliance_risk_scoring dispatches with a numeric result", async () => {
    const result = await dispatchComplianceEngines("compliance_risk_scoring", { overdueItemsCount: 2, pastPenaltiesCount: 1, totalItemsCount: 10 }) as { riskScore: number }
    expect(typeof result.riskScore).toBe("number")
  })
})
