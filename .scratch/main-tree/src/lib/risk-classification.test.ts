/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyRisk } from "./risk-classification"

describe("classifyRisk -- Constitution Guardrail 10, PLAN-16 item (d)", () => {
  test("no factors at all is low risk", () => {
    expect(classifyRisk({})).toBe("low")
  })

  test("platform-wide blast radius is always critical, regardless of amount", () => {
    expect(classifyRisk({ blastRadius: "platform" })).toBe("critical")
  })

  test("a very large financial amount is critical", () => {
    expect(classifyRisk({ financialAmountInr: 5_000_000 })).toBe("critical")
  })

  test("a financial amount just under the critical threshold is high, not critical", () => {
    expect(classifyRisk({ financialAmountInr: 999_999 })).toBe("high")
  })

  test("a mid-size financial amount is high", () => {
    expect(classifyRisk({ financialAmountInr: 150_000 })).toBe("high")
  })

  test("payment/delete/compliance_submission categories are high regardless of amount", () => {
    expect(classifyRisk({ highImpactCategory: "payment" })).toBe("high")
    expect(classifyRisk({ highImpactCategory: "delete" })).toBe("high")
    expect(classifyRisk({ highImpactCategory: "compliance_submission" })).toBe("high")
  })

  test("an irreversible org-wide action is high", () => {
    expect(classifyRisk({ isIrreversible: true, blastRadius: "org" })).toBe("high")
  })

  test("archive/approval/access_changes/data_export/configuration_changes categories are medium", () => {
    expect(classifyRisk({ highImpactCategory: "archive" })).toBe("medium")
    expect(classifyRisk({ highImpactCategory: "approval" })).toBe("medium")
    expect(classifyRisk({ highImpactCategory: "access_changes" })).toBe("medium")
    expect(classifyRisk({ highImpactCategory: "data_export" })).toBe("medium")
    expect(classifyRisk({ highImpactCategory: "configuration_changes" })).toBe("medium")
  })

  test("a small financial amount is medium", () => {
    expect(classifyRisk({ financialAmountInr: 25_000 })).toBe("medium")
  })

  test("an irreversible single-record action (no blast radius escalation) is medium, not high", () => {
    expect(classifyRisk({ isIrreversible: true, blastRadius: "single" })).toBe("medium")
  })

  test("a plain org-wide action with no other risk factor is medium", () => {
    expect(classifyRisk({ blastRadius: "org" })).toBe("medium")
  })

  test("a tiny financial amount below the medium threshold is low", () => {
    expect(classifyRisk({ financialAmountInr: 500 })).toBe("low")
  })

  test("a single-record, reversible, non-financial action is low", () => {
    expect(classifyRisk({ blastRadius: "single", isIrreversible: false })).toBe("low")
  })
})
