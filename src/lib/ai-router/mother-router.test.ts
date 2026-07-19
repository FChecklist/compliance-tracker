// Unit tests for mother-router.ts's PURE resolution functions --
// computeSoftwareTeamResolution / computeEndUserOrgResolution /
// computeSalesMarketingResolution take already-fetched registry/policy
// data as plain arguments and never touch the database, matching this
// codebase's own established pattern (see permission-service.test.ts's own
// header: "No DB access needed... testing the REAL primitives... not a
// mock"). This repo's CI (.github/workflows/ci.yml unit-tests job) runs
// `bun test` against a placeholder DATABASE_URL with no real Postgres
// behind it -- any test that actually queried the DB-backed wrappers
// (resolveModel/getActivePolicy/getOrgAiPackage/rollbackPolicy) would hang
// or fail there, so those wrappers are intentionally NOT exercised here.
// That is a real, disclosed limitation (same class as this repo's own
// "zero E2E tests" note in ci.yml), not a silent gap -- see this PR's
// PROGRESS.md.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeSoftwareTeamResolution,
  computeEndUserOrgResolution,
  computeSalesMarketingResolution,
  computeCustomerSuccessResolution,
  type ActivePolicy,
} from "./mother-router"
import type { ResolvedModelConfig } from "@/lib/orchestra-model-resolver"

describe("computeSoftwareTeamResolution -- software_team scope", () => {
  test("no active policy: returns roster.ts baseline unchanged", () => {
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "judgment", "chief_audit_officer", null)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.provider).toBe("openrouter")
    expect(result.policyVersion).toBeUndefined()
    expect(result.tierEligibility?.eligible).toBe(true)
  })

  // Proves hot-swap: the SAME call, only the policy argument differs (as if
  // a new ai_routing_policies row had just become active) -- the resolved
  // model changes accordingly, with zero code change and no restart
  // involved in this resolution logic.
  test("active policy override for the role: switches model when the override is tier-eligible", () => {
    const policy: ActivePolicy = { version: 2, rule: { preferredModelByRole: { chief_audit_officer: "deepseek/deepseek-v4-pro" } } }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "integrative", "chief_audit_officer", policy)
    expect(result.model).toBe("deepseek/deepseek-v4-pro")
    expect(result.policyVersion).toBe(2)
    expect(result.tierEligibility?.eligible).toBe(true)
  })

  test("active policy names a model NOT eligible for the requested tier: falls back to baseline, never silently grants it", () => {
    const policy: ActivePolicy = { version: 3, rule: { preferredModelByTier: { judgment: "openai/gpt-oss-120b" } } }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "judgment", "chief_audit_officer", policy)
    expect(result.model).toBe("z-ai/glm-5.2") // fell back, did NOT grant gpt-oss-120b judgment-tier work
    expect(result.reason).toContain("not eligible")
    expect(result.policyVersion).toBe(3)
  })

  // Audit-trail correctness: an active policy that happens to name the SAME
  // model as the baseline must still be attributed to the policy (not
  // silently reported as "no active policy") -- otherwise an auditor
  // reading ai_routing_audit_log later can't tell a policy was governing
  // this dispatch at all.
  test("active policy names the same model as baseline: still attributed to the policy in the audit reason, not misreported as no-policy", () => {
    const policy: ActivePolicy = { version: 4, rule: { preferredModelByRole: { chief_audit_officer: "z-ai/glm-5.2" } } }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "judgment", "chief_audit_officer", policy)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.policyVersion).toBe(4)
    expect(result.reason).not.toContain("no active routing policy")
  })

  // Rollback simulation: v2's override existed, then got rolled back
  // (policy argument becomes null again, as rollbackPolicy() would cause
  // the next real DB fetch to return) -- resolution reverts to baseline.
  test("policy rolled back to null: reverts to roster.ts baseline", () => {
    const withOverride = computeSoftwareTeamResolution("z-ai/glm-5.2", "integrative", "chief_audit_officer", {
      version: 2,
      rule: { preferredModelByRole: { chief_audit_officer: "deepseek/deepseek-v4-pro" } },
    })
    expect(withOverride.model).toBe("deepseek/deepseek-v4-pro")

    const afterRollback = computeSoftwareTeamResolution("z-ai/glm-5.2", "integrative", "chief_audit_officer", null)
    expect(afterRollback.model).toBe("z-ai/glm-5.2")
  })
})

// AIROUTER-01 Phase 2 (Software Team L0-L5, Part C routing matrix):
// preferredModelByCapabilityCategory is a NEW, finer axis than
// preferredModelByTier -- checked first when a capabilityCategory is
// supplied, but still gated through the SAME checkTierEligibility() call
// as every other override path (never a guardrail bypass).
describe("computeSoftwareTeamResolution -- capability-category axis (Part C)", () => {
  test("capabilityCategory override present and tier-eligible: wins over preferredModelByTier", () => {
    const policy: ActivePolicy = {
      version: 5,
      rule: {
        preferredModelByCapabilityCategory: { single_file_mechanical: "openai/gpt-oss-20b" },
        preferredModelByTier: { mechanical: "openai/gpt-oss-120b" },
      },
    }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "mechanical", "fullstack_developer", policy, "single_file_mechanical")
    expect(result.model).toBe("openai/gpt-oss-20b")
    expect(result.policyVersion).toBe(5)
  })

  test("no capabilityCategory supplied: falls through to preferredModelByTier unchanged (existing behavior untouched)", () => {
    const policy: ActivePolicy = {
      version: 5,
      rule: {
        preferredModelByCapabilityCategory: { single_file_mechanical: "openai/gpt-oss-20b" },
        preferredModelByTier: { mechanical: "openai/gpt-oss-120b" },
      },
    }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "mechanical", "fullstack_developer", policy)
    expect(result.model).toBe("openai/gpt-oss-120b")
  })

  test("capabilityCategory override NOT tier-eligible: falls back to baseline, never silently granted (mirrors preferredModelByRole's own safety)", () => {
    const policy: ActivePolicy = {
      version: 6,
      rule: { preferredModelByCapabilityCategory: { multi_file_integrative: "openai/gpt-oss-120b" } },
    }
    const result = computeSoftwareTeamResolution("z-ai/glm-5.2", "integrative", "fullstack_developer", policy, "multi_file_integrative")
    expect(result.model).toBe("z-ai/glm-5.2") // gpt-oss-120b is NOT INTEGRATIVE_ELIGIBLE -- must fall back, not be silently granted
    expect(result.reason).toContain("not eligible")
  })

  test("Part C's actual seeded matrix (drizzle/0250): single-file mechanical resolves to the cheap floor tier, not GLM-5.2, even when the role's own roster.ts baseline IS GLM-5.2", () => {
    // Mirrors drizzle/0250 EXACTLY (audit round 1, M5 fix: "multi_file_integrative"
    // deliberately absent from preferredModelByCapabilityCategory -- it falls
    // through to preferredModelByTier.integrative below, same resolved model,
    // zero divergence to disclose for that key).
    const seededPolicy: ActivePolicy = {
      version: 1,
      rule: {
        preferredModelByCapabilityCategory: {
          single_file_mechanical: "openai/gpt-oss-20b",
          architecture_design_analysis: "deepseek/deepseek-v4-pro",
          planning_governance_oversight: "z-ai/glm-5.2",
        },
        preferredModelByTier: { mechanical: "openai/gpt-oss-20b", integrative: "deepseek/deepseek-v4-pro", judgment: "z-ai/glm-5.2" },
      },
    }
    // fullstack_developer's roster.ts baseline is GLM_52 (expensive,
    // judgment-tier) -- this is the concrete case the Owner's cost-bias
    // mandate targets: a mechanical single-file task must NOT quietly stay
    // on the expensive baseline just because that's the role's own default.
    const mechanicalResult = computeSoftwareTeamResolution("z-ai/glm-5.2", "mechanical", "fullstack_developer", seededPolicy, "single_file_mechanical")
    expect(mechanicalResult.model).toBe("openai/gpt-oss-20b")

    // No preferredModelByCapabilityCategory entry for "multi_file_integrative"
    // -- falls through to preferredModelByTier.integrative, proving the
    // fallback chain (not a hardcoded per-category value) is what actually
    // resolves this category to the cheap/mid tier.
    const integrativeResult = computeSoftwareTeamResolution("z-ai/glm-5.2", "integrative", "fullstack_developer", seededPolicy, "multi_file_integrative")
    expect(integrativeResult.model).toBe("deepseek/deepseek-v4-pro")

    const judgmentResult = computeSoftwareTeamResolution("z-ai/glm-5.2", "judgment", "ceo_technical_director", seededPolicy, "planning_governance_oversight")
    expect(judgmentResult.model).toBe("z-ai/glm-5.2") // planning/governance/oversight IS reserved for GLM-5.2, per the Owner's own matrix
  })
})

function fakeResolvedConfig(overrides: Partial<ResolvedModelConfig> = {}): ResolvedModelConfig {
  return {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    apiKey: "test-key",
    isCustomerConfigured: false,
    ...overrides,
  }
}

describe("computeEndUserOrgResolution -- end_user_org scope", () => {
  test("org has its own BYO customer_model_config: Mother Router never overrides it, regardless of any policy", () => {
    const baseline = fakeResolvedConfig({ isCustomerConfigured: true, provider: "anthropic", model: "claude-sonnet-5" })
    const policy: ActivePolicy = { version: 1, rule: { preferredModelByPackage: { basic: { provider: "groq", model: "openai/gpt-oss-120b" } } } }
    const result = computeEndUserOrgResolution(baseline, "basic", policy)
    expect(result.provider).toBe("anthropic")
    expect(result.model).toBe("claude-sonnet-5")
    expect(result.reason).toContain("BYO")
  })

  test("platform default + active policy for the org's aiPackage: applies the package default", () => {
    const baseline = fakeResolvedConfig()
    const policy: ActivePolicy = { version: 5, rule: { preferredModelByPackage: { enterprise: { provider: "anthropic", model: "claude-sonnet-5" } } } }
    const result = computeEndUserOrgResolution(baseline, "enterprise", policy)
    expect(result.provider).toBe("anthropic")
    expect(result.model).toBe("claude-sonnet-5")
    expect(result.policyVersion).toBe(5)
  })

  test("platform default, no policy override for the org's aiPackage: baseline unchanged", () => {
    const baseline = fakeResolvedConfig()
    const policy: ActivePolicy = { version: 5, rule: { preferredModelByPackage: { enterprise: { provider: "anthropic", model: "claude-sonnet-5" } } } }
    const result = computeEndUserOrgResolution(baseline, "basic", policy) // org is "basic", policy only names "enterprise"
    expect(result.provider).toBe(baseline.provider)
    expect(result.model).toBe(baseline.model)
  })

  test("no aiPackage resolvable for the org: baseline unchanged, honest reason given", () => {
    const baseline = fakeResolvedConfig()
    const result = computeEndUserOrgResolution(baseline, null, null)
    expect(result.model).toBe(baseline.model)
    expect(result.reason).toContain("no resolvable subscription aiPackage")
  })
})

describe("computeSalesMarketingResolution -- sales_marketing scope (new)", () => {
  test("role exists in roster.ts, no policy override: returns roster.ts baseline", () => {
    const result = computeSalesMarketingResolution("chief_revenue_officer", "z-ai/glm-5.2", null)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.provider).toBe("openrouter")
  })

  test("role exists, active policy overrides it: switches model", () => {
    const policy: ActivePolicy = { version: 1, rule: { preferredModelByRole: { chief_revenue_officer: "deepseek/deepseek-v4-pro" } } }
    const result = computeSalesMarketingResolution("chief_revenue_officer", "z-ai/glm-5.2", policy)
    expect(result.model).toBe("deepseek/deepseek-v4-pro")
    expect(result.policyVersion).toBe(1)
  })

  test("active policy names the same model as baseline: still attributed to the policy, not misreported as no-policy", () => {
    const policy: ActivePolicy = { version: 2, rule: { preferredModelByRole: { chief_revenue_officer: "z-ai/glm-5.2" } } }
    const result = computeSalesMarketingResolution("chief_revenue_officer", "z-ai/glm-5.2", policy)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.policyVersion).toBe(2)
    expect(result.reason).not.toContain("no active routing policy")
  })

  test("roleKey has no baseline model (not in roster.ts, or human/code-only): honest empty resolution, never invents one", () => {
    const result = computeSalesMarketingResolution("linkedin_content_writer", null, null)
    expect(result.model).toBe("")
    expect(result.reason).toContain("not found in roster.ts")
  })
})

describe("computeCustomerSuccessResolution -- customer_success scope (new)", () => {
  test("role exists in roster.ts, no policy override: returns roster.ts baseline", () => {
    const result = computeCustomerSuccessResolution("l2_technical_support", "z-ai/glm-5.2", null)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.provider).toBe("openrouter")
    expect(result.reason).toContain("no active routing policy override")
  })

  test("role exists, active policy overrides it: switches model", () => {
    const policy: ActivePolicy = { version: 1, rule: { preferredModelByRole: { l2_technical_support: "deepseek/deepseek-v4-pro" } } }
    const result = computeCustomerSuccessResolution("l2_technical_support", "z-ai/glm-5.2", policy)
    expect(result.model).toBe("deepseek/deepseek-v4-pro")
    expect(result.policyVersion).toBe(1)
  })

  test("active policy names the same model as baseline: still attributed to the policy, not misreported as no-policy", () => {
    const policy: ActivePolicy = { version: 2, rule: { preferredModelByRole: { l2_technical_support: "z-ai/glm-5.2" } } }
    const result = computeCustomerSuccessResolution("l2_technical_support", "z-ai/glm-5.2", policy)
    expect(result.model).toBe("z-ai/glm-5.2")
    expect(result.policyVersion).toBe(2)
    expect(result.reason).not.toContain("no active routing policy")
  })

  test("roleKey has no baseline model (not in roster.ts, or human/code-only): honest empty resolution, never invents one", () => {
    const result = computeCustomerSuccessResolution("not_a_real_customer_success_role", null, null)
    expect(result.model).toBe("")
    expect(result.reason).toContain("not found in roster.ts")
  })
})
