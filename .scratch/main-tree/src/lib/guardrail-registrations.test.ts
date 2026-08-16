/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { evaluateGuardrails } from "./guardrail-engine"
import {
  registerAllGuardrails, AI_TEAM_CLOSURE_REVIEW_LEAF,
  GST_SPLIT_ENGINE_LEAVES, LOAN_ENGINE_LEAVES, GRATUITY_CALCULATOR_LEAF, COMMISSION_CALCULATOR_LEAF,
  AI_DOCUMENT_EXTRACTION_LEAF,
} from "./guardrail-registrations"

registerAllGuardrails()

describe("closureReviewCheck (AI_TEAM_CLOSURE_REVIEW_LEAF) -- Wave 165, U-D12.B4.S3", () => {
  test("rejects a review with no notes", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewDecision: "approved" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_notes_missing_or_too_short")
  })

  test("rejects a review with notes too short to be substantive", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "ok", reviewDecision: "approved" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_notes_missing_or_too_short")
  })

  test("rejects a review with a missing decision", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This output correctly handles the edge case." })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_decision_missing_or_invalid")
  })

  test("rejects a review with an invalid decision value", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This output correctly handles the edge case.", reviewDecision: "maybe" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_decision_missing_or_invalid")
  })

  test("passes a real review with substantive notes and a valid decision", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "Verified the calculation against the source spec -- matches.", reviewDecision: "approved" })
    expect(result).toEqual({ passed: true })
  })

  test("passes a rejection with substantive notes too -- the check validates rigor, not outcome", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This misses the edge case where the input is negative.", reviewDecision: "rejected" })
    expect(result).toEqual({ passed: true })
  })

  describe("confidence banding (D18/PLAN-20, Guardrail 9)", () => {
    const NOTES = "Verified the calculation against the source spec -- matches."

    test("passes when no confidencePercentage is supplied at all (optional, backward compatible)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved" })
      expect(result).toEqual({ passed: true })
    })

    test("passes an approval at 95% confidence (self_review band, weaker than the peer review already happening)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 95 })
      expect(result).toEqual({ passed: true })
    })

    test("passes an approval at 92% confidence (peer_review band -- exactly what's happening)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 92 })
      expect(result).toEqual({ passed: true })
    })

    test("blocks an approval below 90% -- escalation_required band cannot be approved directly", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 75 })
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason).toBe("confidence_below_escalation_threshold")
        expect(result.guidance).toContain("Escalate to")
      }
    })

    test("allows a rejection below 90% -- rejecting isn't the same as silently approving a low-confidence result", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "rejected", confidencePercentage: 60 })
      expect(result).toEqual({ passed: true })
    })
  })

  describe("audit-cadence routing (area 9 item 1, Guardrail 10 risk level)", () => {
    const NOTES = "Verified the calculation against the source spec -- matches."

    test("blocks a critical-risk approval even at 100% confidence -- risk level determines escalation independent of confidence", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 100, riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason).toBe("critical_risk_requires_escalation")
        expect(result.guidance).toContain("Escalate")
      }
    })

    test("blocks a critical-risk approval when no confidencePercentage was supplied at all", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("critical_risk_requires_escalation")
    })

    test("allows a critical-risk rejection -- rejecting isn't approving, so the gate doesn't apply", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "rejected", riskLevel: "critical" })
      expect(result).toEqual({ passed: true })
    })

    test("allows a high-risk approval -- only critical forces escalation regardless of confidence, high only flags L4 visibility", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 99, riskLevel: "high" })
      expect(result).toEqual({ passed: true })
    })

    test("allows a low-risk approval with no riskLevel supplied (backward compatible)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved" })
      expect(result).toEqual({ passed: true })
    })

    test("low-confidence escalation_required check still fires before the risk check when both apply, with its own distinct reason", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 50, riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("confidence_below_escalation_threshold")
    })
  })
})

describe("Business Rule Validation Before Execution (VERIDIAN Review Framework, 'process' phase)", () => {
  test("GST split engines reject an out-of-range rate", () => {
    for (const leaf of GST_SPLIT_ENGINE_LEAVES) {
      const result = evaluateGuardrails(leaf, "process", { gstRatePercent: 1800 })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("gst_rate_out_of_bounds")
    }
  })

  test("GST split engines pass a real GST slab rate", () => {
    for (const leaf of GST_SPLIT_ENGINE_LEAVES) {
      expect(evaluateGuardrails(leaf, "process", { gstRatePercent: 18 })).toEqual({ passed: true })
    }
  })

  test("loan engines reject a tenure past the 50-year sanity ceiling", () => {
    for (const leaf of LOAN_ENGINE_LEAVES) {
      const result = evaluateGuardrails(leaf, "process", { principal: 100000, annualRatePercent: 10, tenureMonths: 1200 })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("loan_tenure_out_of_bounds")
    }
  })

  test("loan engines reject a non-positive principal", () => {
    const result = evaluateGuardrails("emi_calculator", "process", { principal: -1, annualRatePercent: 10, tenureMonths: 12 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("loan_principal_out_of_bounds")
  })

  test("loan engines reject an implausible interest rate", () => {
    const result = evaluateGuardrails("loan_schedule_generator", "process", { principal: 100000, annualRatePercent: 999, tenureMonths: 12 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("loan_rate_out_of_bounds")
  })

  test("loan engines pass a realistic EMI input", () => {
    expect(evaluateGuardrails("amortization_engine", "process", { principal: 500000, annualRatePercent: 9.5, tenureMonths: 60 })).toEqual({ passed: true })
  })

  test("gratuity calculator rejects years of service past a working lifetime", () => {
    const result = evaluateGuardrails(GRATUITY_CALCULATOR_LEAF, "process", { lastDrawnMonthlySalary: 50000, yearsOfService: 90 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("gratuity_years_out_of_bounds")
  })

  test("gratuity calculator rejects a non-positive salary", () => {
    const result = evaluateGuardrails(GRATUITY_CALCULATOR_LEAF, "process", { lastDrawnMonthlySalary: 0, yearsOfService: 10 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("gratuity_salary_out_of_bounds")
  })

  test("gratuity calculator passes realistic inputs", () => {
    expect(evaluateGuardrails(GRATUITY_CALCULATOR_LEAF, "process", { lastDrawnMonthlySalary: 60000, yearsOfService: 7.6 })).toEqual({ passed: true })
  })

  test("commission calculator rejects a rate above a sane sales-commission ceiling", () => {
    const result = evaluateGuardrails(COMMISSION_CALCULATOR_LEAF, "process", { saleAmount: 100000, commissionRatePercent: 90 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("commission_rate_out_of_bounds")
  })

  test("commission calculator passes a realistic rate", () => {
    expect(evaluateGuardrails(COMMISSION_CALCULATOR_LEAF, "process", { saleAmount: 100000, commissionRatePercent: 5 })).toEqual({ passed: true })
  })
})

describe("AI Output Validation by Business Rules (AI_DOCUMENT_EXTRACTION_LEAF, 'output' phase)", () => {
  test("rejects an AI-extracted GSTIN that fails checksum", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { gstin: "27AAPFU0939F1Z6" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_gstin_invalid")
  })

  test("accepts a real, checksum-valid GSTIN", () => {
    expect(evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { gstin: "27AAPFU0939F1ZV" })).toEqual({ passed: true })
  })

  test("rejects an AI-extracted PAN with an invalid format", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { pan: "12345ABCDE" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_pan_invalid")
  })

  test("rejects an implausible negative demand amount", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { demandAmount: -500 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_demand_amount_implausible")
  })

  test("rejects a demand amount above the sanity ceiling", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { demandAmount: 5_000_000_000 })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_demand_amount_implausible")
  })

  test("rejects a compliance type outside the recognised enum", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { complianceType: "SOMETHING_MADE_UP" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_compliance_type_invalid")
  })

  test("rejects an unparseable due date", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", { dueDate: "not-a-date" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("extracted_due_date_invalid")
  })

  test("passes a fully clean, real-world extraction", () => {
    const result = evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", {
      gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F", demandAmount: 25000, complianceType: "GST", dueDate: "2026-08-15",
    })
    expect(result).toEqual({ passed: true })
  })

  test("passes when every optional field is null/absent -- nothing to validate", () => {
    expect(evaluateGuardrails(AI_DOCUMENT_EXTRACTION_LEAF, "output", {})).toEqual({ passed: true })
  })
})
