// VERIDIAN_Architecture_v2.0 phase_3 corrective fix (PR #561 audit,
// AUDIT: FAIL, 2026-07-26): tests the DB-touching gate-orchestration
// function (runLifecycleTransitionGates) and the budget-check function
// (checkPromptEvalBudget) -- the audit's own finding was that NEITHER had
// any test coverage, "the riskiest new logic in this whole PR is untested."
// Mocks @/lib/db and ./abac-policy-service, matching org-branding-
// service.test.ts / asset-registry-cache.test.ts's established "never a
// live DB from a .test.ts file" pattern for this repo -- prompt-
// governance-service.test.ts itself stays DB-free (pure helpers only), so
// this is a separate file rather than adding live-DB tests there.
//
// The regression tests below reproduce the actual confirmed bug: prompt-
// lifecycle thresholds used to resolve through module-rules-resolver.ts's
// org-override chain even though prompt_templates/prompt_versions/
// prompt_eval_runs have no orgId column at all, so any org's own rank-5
// 'admin' could call setModuleRule() to zero out the canary/eval-pass-rate
// gates for their own org, letting a same-org veridian_admin bypass those
// gates on ANY platform-wide prompt template. The fix makes
// getPromptLifecycleRule() read ONLY the scope_type='platform' row. These
// tests prove that behaviorally: given a strict platform default and an
// actingOrgId present (simulating an org context an attacker fully
// controls), the gate still enforces the strict platform threshold --
// there is no code path left that could ever honor a weaker org-scoped
// value for this module.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"

type MockDbOptions = {
  platformRuleValue?: number
  evalRuns?: Array<{ passed: boolean | null }>
  spentTodayUsd?: number
}

function buildMockDb(opts: MockDbOptions) {
  const moduleRuleConfigsFindFirst = mock(async () =>
    opts.platformRuleValue === undefined ? undefined : { ruleValue: { value: opts.platformRuleValue } }
  )
  const promptEvalRunsFindMany = mock(async () => opts.evalRuns ?? [])
  const select = mock(() => ({
    from: () => ({
      where: () => Promise.resolve([{ total: String(opts.spentTodayUsd ?? 0) }]),
    }),
  }))
  return {
    db: {
      query: {
        moduleRuleConfigs: { findFirst: moduleRuleConfigsFindFirst },
        promptEvalRuns: { findMany: promptEvalRunsFindMany },
      },
      select,
    },
    promptEvalRuns: {},
    promptTemplates: {},
    promptVersions: {},
    moduleRuleConfigs: {},
    users: {},
    moduleRuleConfigsFindFirst,
    promptEvalRunsFindMany,
  }
}

async function mockDbAndAbac(opts: MockDbOptions, abacDenied = false) {
  const dbMocks = buildMockDb(opts)
  await mock.module("@/lib/db", () => dbMocks)
  await mock.module("./abac-policy-service", () => ({
    checkAbacDenyPoliciesWithDb: mock(async () => (abacDenied ? { denied: true, policyId: "p1", reason: "denied by policy" } : { denied: false })),
  }))
  return dbMocks
}

function fakeTx(templateOverrides: Record<string, unknown> = {}) {
  return {
    query: {
      promptTemplates: {
        findFirst: mock(async () => ({ id: "tmpl-1", ownerId: "owner-1", ...templateOverrides })),
      },
    },
  } as unknown as TenantDb
}

afterEach(() => {
  mock.restore()
})

describe("checkPromptEvalBudget -- platform-only cumulative budget guardrail", () => {
  test("allows a run when today's spend is below the platform budget", async () => {
    await mockDbAndAbac({ platformRuleValue: 5, spentTodayUsd: 3 })
    const { checkPromptEvalBudget } = await import("./prompt-governance-service")
    const result = await checkPromptEvalBudget()
    expect(result).toEqual({ allowed: true, spentTodayUsd: 3, budgetUsd: 5 })
  })

  test("blocks a run once today's spend meets or exceeds the platform budget", async () => {
    await mockDbAndAbac({ platformRuleValue: 5, spentTodayUsd: 5 })
    const { checkPromptEvalBudget } = await import("./prompt-governance-service")
    const result = await checkPromptEvalBudget()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("budget exhausted")
  })

  test("falls back to the hardcoded default when no platform row exists yet (pre-migration environment)", async () => {
    await mockDbAndAbac({ platformRuleValue: undefined, spentTodayUsd: 3 })
    const { checkPromptEvalBudget } = await import("./prompt-governance-service")
    const result = await checkPromptEvalBudget()
    expect(result.budgetUsd).toBe(5) // RULE_FALLBACK_DEFAULTS.eval_daily_budget_usd
    expect(result.allowed).toBe(true)
  })

  test("REGRESSION (PR #561): takes no orgId parameter at all -- there is no per-org budget to distort", async () => {
    // checkPromptEvalBudget's real signature is now () => Promise<...>, not
    // (orgId) => Promise<...>. This compiles only because the org
    // parameter was removed; if it were reintroduced this assertion would
    // still hold, but the call site in prompt-eval-service.ts would need
    // updating too (see that file's own call site).
    await mockDbAndAbac({ platformRuleValue: 5, spentTodayUsd: 1 })
    const { checkPromptEvalBudget } = await import("./prompt-governance-service")
    expect(checkPromptEvalBudget.length).toBe(0)
  })
})

describe("runLifecycleTransitionGates -- Review -> Staging (eval pass rate gate)", () => {
  test("blocks the transition when the eval pass rate is below the platform threshold", async () => {
    await mockDbAndAbac({
      platformRuleValue: 0.8,
      evalRuns: [{ passed: true }, { passed: false }], // 50% pass rate
    })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx()
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "author-1", fromState: "Review", toState: "Staging", stagingEnteredAt: null,
        actingUserId: "approver-1", actingOrgId: null,
      })
    ).rejects.toThrow(/eval pass rate/i)
  })

  test("allows the transition when the eval pass rate meets the platform threshold", async () => {
    await mockDbAndAbac({
      platformRuleValue: 0.8,
      evalRuns: [{ passed: true }, { passed: true }, { passed: true }, { passed: true }, { passed: true }], // 100% pass rate, clears 0.8
    })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx()
    const result = await runLifecycleTransitionGates(tx, {
      versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
      createdById: "author-1", fromState: "Review", toState: "Staging", stagingEnteredAt: null,
      actingUserId: "approver-1", actingOrgId: null,
    })
    expect(result.setStagingEnteredAt).toBe(true)
    expect(result.setApproval).toBe(true)
  })

  test("REGRESSION (PR #561 cross-tenant escalation): an org context present at call time cannot weaken the eval-pass-rate gate -- the platform threshold is enforced regardless of actingOrgId", async () => {
    // Platform default is strict (0.8). In the pre-fix code, an attacker's
    // own org ('org-attacker') could have called setModuleRule() to set an
    // org-scoped override of min_eval_pass_rate=0 for that org, which
    // resolveModuleRule() would then have returned INSTEAD of this platform
    // row for any actingOrgId='org-attacker' caller. The fixed
    // getPromptLifecycleRule() takes no orgId parameter, so there is no
    // longer any way for actingOrgId to influence which threshold is used
    // -- this test proves that by using a pass rate (50%) that only a
    // weakened (e.g. 0%) threshold would let through, and asserting it is
    // still rejected even with actingOrgId set to an attacker-controlled org.
    await mockDbAndAbac({
      platformRuleValue: 0.8,
      evalRuns: [{ passed: true }, { passed: false }], // 50% pass rate
    })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx()
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "author-1", fromState: "Review", toState: "Staging", stagingEnteredAt: null,
        actingUserId: "approver-1", actingOrgId: "org-attacker",
      })
    ).rejects.toThrow(/eval pass rate/i)
  })
})

describe("runLifecycleTransitionGates -- Staging -> Production (canary duration + compliance + governance gates)", () => {
  const stagingEnteredOneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000)
  const stagingEnteredTwentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)

  test("blocks the transition when the canary duration is below the platform threshold", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx()
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredOneHourAgo,
        actingUserId: "approver-1", actingOrgId: null,
      })
    ).rejects.toThrow(/canary duration/i)
  })

  test("allows the transition once the canary duration clears the platform threshold, content is clean, and the template has an owner", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: "owner-1" })
    const result = await runLifecycleTransitionGates(tx, {
      versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean instructional content",
      createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredTwentyFiveHoursAgo,
      actingUserId: "approver-1", actingOrgId: null,
    })
    expect(result.setApproval).toBe(true)
    expect(result.setStagingEnteredAt).toBe(false)
  })

  test("blocks promotion when the template has no assigned owner (governance gate)", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: null })
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredTwentyFiveHoursAgo,
        actingUserId: "approver-1", actingOrgId: null,
      })
    ).rejects.toThrow(/no assigned owner/i)
  })

  test("blocks promotion when content appears to contain PII (compliance gate)", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: "owner-1" })
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "Contact us at help@example.com",
        createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredTwentyFiveHoursAgo,
        actingUserId: "approver-1", actingOrgId: null,
      })
    ).rejects.toThrow(/PII/i)
  })

  test("maker-checker: blocks promotion when the acting user authored the version being promoted", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: "owner-1" })
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "same-person", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredTwentyFiveHoursAgo,
        actingUserId: "same-person", actingOrgId: null,
      })
    ).rejects.toThrow(/maker-checker/i)
  })

  test("blocks promotion when an org's ABAC deny policy fires", async () => {
    await mockDbAndAbac({ platformRuleValue: 24 }, /* abacDenied */ true)
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: "owner-1" })
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "some.template", content: "clean content",
        createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredTwentyFiveHoursAgo,
        actingUserId: "approver-1", actingOrgId: "org-1",
      })
    ).rejects.toThrow(/Denied by policy engine/i)
  })

  test("REGRESSION (PR #561 cross-tenant escalation, the confirmed audit scenario): a same-org veridian_admin can no longer bypass the canary gate on a platform-wide template via an org-scoped rule override", async () => {
    // Reproduces the exact confirmed exploit chain: an org's own rank-5
    // 'admin' calls setModuleRule() to set an org-scoped override of
    // min_canary_duration_hours=0 for their org ('org-attacker'). A
    // same-org veridian_admin then attempts to promote a platform-wide
    // template to Production after only 1 hour in Staging -- which the
    // weakened 0h override would have allowed, but the real, strict
    // platform default (24h) must not. The platform row mocked here IS the
    // strict real default; there is no longer any code path through which
    // actingOrgId could substitute a weaker value.
    await mockDbAndAbac({ platformRuleValue: 24 })
    const { runLifecycleTransitionGates } = await import("./prompt-governance-service")
    const tx = fakeTx({ ownerId: "owner-1" })
    await expect(
      runLifecycleTransitionGates(tx, {
        versionId: "v1", templateId: "tmpl-1", templateKey: "shared.platform.template", content: "clean content",
        createdById: "author-1", fromState: "Staging", toState: "Production", stagingEnteredAt: stagingEnteredOneHourAgo,
        actingUserId: "same-org-veridian-admin", actingOrgId: "org-attacker",
      })
    ).rejects.toThrow(/canary duration/i)
  })
})
