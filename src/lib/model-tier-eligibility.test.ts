/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isModelEligibleForTier, checkTierEligibility, requiresMandatoryAudit } from "./model-tier-eligibility"

describe("isModelEligibleForTier", () => {
  test("every model is eligible for mechanical, including GPT-OSS-120B", () => {
    for (const model of ["openai/gpt-oss-120b", "deepseek/deepseek-v4-pro", "z-ai/glm-5.2", "some/unknown-model"]) {
      expect(isModelEligibleForTier(model, "mechanical")).toBe(true)
    }
  })

  test("GPT-OSS-120B is excluded from integrative -- confirmed 2x failure this session", () => {
    expect(isModelEligibleForTier("openai/gpt-oss-120b", "integrative")).toBe(false)
  })

  test("DeepSeek V4 Pro is eligible for integrative -- design competence confirmed despite budget issue", () => {
    expect(isModelEligibleForTier("deepseek/deepseek-v4-pro", "integrative")).toBe(true)
  })

  test("GLM-5.2 is eligible for all three tiers", () => {
    expect(isModelEligibleForTier("z-ai/glm-5.2", "mechanical")).toBe(true)
    expect(isModelEligibleForTier("z-ai/glm-5.2", "integrative")).toBe(true)
    expect(isModelEligibleForTier("z-ai/glm-5.2", "judgment")).toBe(true)
  })

  test("only judgment-eligible models pass the judgment tier", () => {
    expect(isModelEligibleForTier("z-ai/glm-5.2", "judgment")).toBe(true)
    expect(isModelEligibleForTier("deepseek/deepseek-v4-pro", "judgment")).toBe(false)
    expect(isModelEligibleForTier("openai/gpt-oss-120b", "judgment")).toBe(false)
  })

  test("gpt-5.5 is no longer judgment-eligible -- removed 2026-07-14 (founder directive: cost + unbounded-escalation-pattern concern)", () => {
    expect(isModelEligibleForTier("openai/gpt-5.5", "judgment")).toBe(false)
  })

  test("an unknown/new model defaults to mechanical-only, not broadly trusted", () => {
    expect(isModelEligibleForTier("some/brand-new-model", "mechanical")).toBe(true)
    expect(isModelEligibleForTier("some/brand-new-model", "integrative")).toBe(false)
    expect(isModelEligibleForTier("some/brand-new-model", "judgment")).toBe(false)
  })
})

describe("requiresMandatoryAudit", () => {
  test("judgment-eligible models do not require mandatory audit", () => {
    expect(requiresMandatoryAudit("z-ai/glm-5.2")).toBe(false)
  })

  test("GPT-OSS-120B, DeepSeek V4 Pro, and gpt-5.5 require mandatory audit -- none has earned judgment-tier trust (gpt-5.5's removed 2026-07-14, see roster.ts's GPT_55 comment)", () => {
    expect(requiresMandatoryAudit("openai/gpt-oss-120b")).toBe(true)
    expect(requiresMandatoryAudit("deepseek/deepseek-v4-pro")).toBe(true)
    expect(requiresMandatoryAudit("openai/gpt-5.5")).toBe(true)
  })

  test("an unknown model requires mandatory audit by default", () => {
    expect(requiresMandatoryAudit("some/brand-new-model")).toBe(true)
  })
})

describe("checkTierEligibility", () => {
  test("returns eligible:true for an allowed combination", () => {
    expect(checkTierEligibility("z-ai/glm-5.2", "judgment")).toEqual({ eligible: true })
  })

  test("returns a specific, actionable reason for GPT-OSS-120B on integrative", () => {
    const result = checkTierEligibility("openai/gpt-oss-120b", "integrative")
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain("openai/gpt-oss-120b")
      expect(result.guidance).toContain("confirmed twice")
    }
  })

  test("returns a specific reason for a non-judgment model on judgment tier", () => {
    const result = checkTierEligibility("deepseek/deepseek-v4-pro", "judgment")
    expect(result.eligible).toBe(false)
    if (!result.eligible) expect(result.guidance).toContain("glm-5.2")
  })
})
