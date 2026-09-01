/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  AI_ESCALATION_TIERS,
  PERCEPTION_MODELS,
  PERCEPTION_VISION_FALLBACK,
  REASONING_MODELS,
  AUTHORITY_PRODUCTION_MODEL,
  getEscalationModelsForTier,
  type EscalationModelSpec,
} from "./escalation-tier-catalog"
import { isModelEligibleForTier } from "@/lib/model-tier-eligibility"
import { AI_TEAM_ROSTER } from "@/lib/ai-team/roster"

describe("AI_ESCALATION_TIERS", () => {
  test("is exactly the 3 directive-named tiers, in directive order", () => {
    expect(AI_ESCALATION_TIERS).toEqual(["PERCEPTION", "REASONING", "AUTHORITY"])
  })
})

describe("REASONING_MODELS.standard -- cross-checked against real, live-registered facts", () => {
  test("is z-ai/glm-5.2, the directive's exact §12 string", () => {
    expect(REASONING_MODELS.standard.model).toBe("z-ai/glm-5.2")
  })

  test("is judgment-eligible per model-tier-eligibility.ts -- the strongest real anchor a model can have in this codebase", () => {
    expect(isModelEligibleForTier(REASONING_MODELS.standard.model, "judgment")).toBe(true)
  })

  test("is the model roster.ts actually assigns to a real, dispatchable role today (not just declared)", () => {
    const liveRole = AI_TEAM_ROSTER.find((r) => r.model === REASONING_MODELS.standard.model)
    expect(liveRole).toBeDefined()
  })

  test("routes through openrouter, matching roster.ts's own header convention that every roster model is called via OpenRouter", () => {
    expect(REASONING_MODELS.standard.provider).toBe("openrouter")
  })
})

describe("PERCEPTION_VISION_FALLBACK -- the one directive vision string Phase 0 already confirmed real", () => {
  test("is z-ai/glm-5v-turbo, the directive's exact §11 fallback string", () => {
    expect(PERCEPTION_VISION_FALLBACK.model).toBe("z-ai/glm-5v-turbo")
  })

  test("is integrative-eligible (real capability tier already earned in this codebase)", () => {
    expect(isModelEligibleForTier(PERCEPTION_VISION_FALLBACK.model, "integrative")).toBe(true)
  })

  test("is the model roster.ts actually assigns to a real, dispatchable role today (frontend_engineer / uat_qa_engineer)", () => {
    const liveRoles = AI_TEAM_ROSTER.filter((r) => r.model === PERCEPTION_VISION_FALLBACK.model)
    expect(liveRoles.length).toBeGreaterThan(0)
    expect(liveRoles.map((r) => r.roleKey)).toContain("frontend_engineer")
  })
})

describe("PERCEPTION_MODELS -- directive §11 exact strings (live-catalog-verified 2026-09-01, see file header)", () => {
  test("text model is the directive's exact §11 string", () => {
    expect(PERCEPTION_MODELS.text.model).toBe("deepseek/deepseek-v4-flash-0731")
  })

  test("vision primary model is the directive's exact §11 string (lowercased/slugified)", () => {
    expect(PERCEPTION_MODELS.vision.model).toBe("z-ai/glm-5.3-flash")
  })

  test("neither perception model is currently registered in roster.ts -- honest, not silently claimed as already-live", () => {
    // These two are NOT expected to already exist in roster.ts (that's exactly
    // the gap the Phase 0 report flagged) -- this test documents that fact
    // explicitly rather than leaving it an unstated assumption, and will fail
    // loudly (prompting an update to this file's own notes) the moment a
    // future PR actually wires either model into roster.ts.
    const rosterModels = new Set(AI_TEAM_ROSTER.map((r) => r.model))
    expect(rosterModels.has(PERCEPTION_MODELS.text.model)).toBe(false)
    expect(rosterModels.has(PERCEPTION_MODELS.vision.model)).toBe(false)
  })
})

describe("REASONING_MODELS.longDocument -- directive §12 dated variant (live-catalog-verified 2026-09-01)", () => {
  test("is the directive's exact dated string, distinct from roster.ts's undated deepseek/deepseek-v4-pro", () => {
    expect(REASONING_MODELS.longDocument.model).toBe("deepseek/deepseek-v4-pro-0813")
    expect(REASONING_MODELS.longDocument.model).not.toBe("deepseek/deepseek-v4-pro")
  })
})

describe("AUTHORITY_PRODUCTION_MODEL -- never a local-CLI path", () => {
  test("is anthropic/claude-sonnet-5 via openrouter, per the confirmed dev-vs-prod provider decision", () => {
    expect(AUTHORITY_PRODUCTION_MODEL.provider).toBe("openrouter")
    expect(AUTHORITY_PRODUCTION_MODEL.model).toBe("anthropic/claude-sonnet-5")
  })

  test("every catalog entry's provider is a valid LLMProvider value -- 'claude-cli' is not in that union, so this is a real type-level guarantee, not just a runtime check", () => {
    const allSpecs: EscalationModelSpec[] = [
      ...getEscalationModelsForTier("PERCEPTION"),
      ...getEscalationModelsForTier("REASONING"),
      ...getEscalationModelsForTier("AUTHORITY"),
    ]
    const validProviders = new Set(["groq", "openai", "anthropic", "google", "openrouter", "cerebras"])
    for (const spec of allSpecs) {
      expect(validProviders.has(spec.provider)).toBe(true)
      expect(spec.provider).not.toBe("claude-cli")
    }
  })
})

describe("getEscalationModelsForTier", () => {
  test("PERCEPTION returns text + vision primary + vision fallback (3 specs)", () => {
    expect(getEscalationModelsForTier("PERCEPTION")).toEqual([
      PERCEPTION_MODELS.text,
      PERCEPTION_MODELS.vision,
      PERCEPTION_VISION_FALLBACK,
    ])
  })

  test("REASONING returns standard + long-document (2 specs)", () => {
    expect(getEscalationModelsForTier("REASONING")).toEqual([REASONING_MODELS.standard, REASONING_MODELS.longDocument])
  })

  test("AUTHORITY returns exactly the production model (1 spec) -- no dev-CLI entry, by construction", () => {
    expect(getEscalationModelsForTier("AUTHORITY")).toEqual([AUTHORITY_PRODUCTION_MODEL])
  })

  test("covers every tier in AI_ESCALATION_TIERS with at least one spec", () => {
    for (const tier of AI_ESCALATION_TIERS) {
      expect(getEscalationModelsForTier(tier).length).toBeGreaterThan(0)
    }
  })
})
