/// <reference types="bun-types" />
// Regression test for a real, live-found bug: GAP-SETTINGS-SUBSCRIPTION-TAB-
// NOT-RENDERING (OCID-050 independent re-verification, UMR-20260802-165606-4413).
//
// Live evidence: GET /api/me consistently took ~5-9s against a real,
// pre-existing large legacy org (4 repeated direct calls, 5.0-5.4s each,
// ruling out a one-off cold start -- see UMR-20260804-234032-146e's report).
// Root cause: this handler ran 9 independent lookups (org, 5 product-branch
// enablement checks, branding, subscription plan status, assistants-used)
// as 9 sequential `await`s, each opening its own withTenantContext
// transaction, even though none of them depends on another's result.
// While this request is in flight, every client of /api/me is stuck on its
// pre-fetch default -- settings/page.tsx's `isAdmin` (fixed separately, in
// that file) is the one this gap named specifically.
//
// Same isolation convention as departments/route.test.ts: mock every real
// dependency, no live DB. The concurrency assertion below is a real timing
// check (each dependency mocked with an artificial delay) -- it fails if
// this route ever regresses back to sequential awaits.
import { describe, test, expect, mock } from "bun:test"

function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const DELAY_MS = 60

// bun test's mock.module() replaces a module for the whole test process, not
// just this file -- fully replacing these modules (like the two below) would
// break any other .test.ts file that imports the real, unrelated exports
// they also carry (confirmed: subscription-plan-service.ts also exports
// resolveSubscriptionPlan/provisionAiAssistantsForUser/etc, which
// users/route.test.ts's own mocked org-license-service chain touches
// indirectly). Spread the real module and override only what this file
// needs, matching the established convention (construction-billing-
// workflow-service.test.ts, erp-selling-service.test.ts, etc).
async function mockAllDependencies(orgId: string | null, dbUser: { id: string; role: string } | null) {
  const realPms = await import("@/lib/services/pms-enablement-service")
  const realVeriChatV2 = await import("@/lib/services/veri-chat-v2-enablement-service")
  const realFirm = await import("@/lib/services/firm-enablement-service")
  const realErp = await import("@/lib/services/erp-enablement-service")
  const realCrm = await import("@/lib/services/crm-enablement-service")
  const realOrgBranding = await import("@/lib/services/org-branding-service")
  const realSubscriptionPlan = await import("@/lib/services/subscription-plan-service")
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, orgId, dbUser })),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      delayed(
        fn({
          query: {
            organisations: {
              findFirst: async () =>
                delayed(
                  { id: orgId, name: "Test Org", slug: "test-org", entityType: "company", accountType: "company", regulatoryEntityType: "general", plan: "pro", trialEndsAt: null },
                  DELAY_MS
                ),
            },
          },
        }),
        DELAY_MS
      )
    ),
  }))
  mock.module("@/lib/services/pms-enablement-service", () => ({ ...realPms, isPmsEnabledForOrg: mock(async () => delayed(false, DELAY_MS)) }))
  mock.module("@/lib/services/veri-chat-v2-enablement-service", () => ({ ...realVeriChatV2, isVeriChatV2EnabledForOrg: mock(async () => delayed(true, DELAY_MS)) }))
  mock.module("@/lib/services/firm-enablement-service", () => ({ ...realFirm, isFirmEnabledForOrg: mock(async () => delayed(true, DELAY_MS)) }))
  mock.module("@/lib/services/erp-enablement-service", () => ({ ...realErp, isErpEnabledForOrg: mock(async () => delayed(false, DELAY_MS)) }))
  mock.module("@/lib/services/crm-enablement-service", () => ({ ...realCrm, isSalesEnabledForOrg: mock(async () => delayed(true, DELAY_MS)) }))
  mock.module("@/lib/services/org-branding-service", () => ({
    ...realOrgBranding,
    resolveBranding: mock(async () => delayed({ logoUrl: null, faviconUrl: null, brandName: "VERIDIAN AI OS", primaryColor: "#1C2B3A", accentColor: "#F5820A" }, DELAY_MS)),
  }))
  mock.module("@/lib/services/subscription-plan-service", () => ({
    ...realSubscriptionPlan,
    getSubscriptionPlanStatus: mock(async () => delayed({ subscriptionPlanId: null, subscriptionPlanName: "Professional", assistantsPerUserLimit: 8, resolvedViaFallback: true }, DELAY_MS)),
    getAssistantsUsedByUser: mock(async () => delayed(5, DELAY_MS)),
  }))
}

describe("GET /api/me (perf regression -- OCID-050)", () => {
  test("REGRESSION: the 9 independent org/user lookups run concurrently, not sequentially", async () => {
    await mockAllDependencies("org-1", { id: "user-1", role: "admin" })
    const { GET } = await import("./route")

    const t0 = performance.now()
    const res = await GET()
    const elapsedMs = performance.now() - t0

    expect(res.status).toBe(200)
    // 9 sequential awaits at DELAY_MS each would take >= 9 * DELAY_MS
    // (540ms). Run concurrently, this should land close to ~2 * DELAY_MS
    // (withTenantContext's own delay + the org query's nested delay) --
    // generously bounded well under half the sequential total so this
    // doesn't flake on a loaded CI runner, while still catching a real
    // regression back to sequential awaits.
    expect(elapsedMs).toBeLessThan(DELAY_MS * 4.5)
  })

  test("shapes the full response correctly once all lookups resolve", async () => {
    await mockAllDependencies("org-1", { id: "user-1", role: "admin" })
    const { GET } = await import("./route")
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({
      id: "user-1",
      name: null,
      email: null,
      role: "admin",
      accountStage: null,
      orgId: "org-1",
      orgName: "Test Org",
      orgSlug: "test-org",
      orgEntityType: "company",
      orgAccountType: "company",
      orgRegulatoryEntityType: "general",
      pmsEnabled: false,
      veriChatV2Enabled: true,
      firmEnabled: true,
      erpEnabled: false,
      salesEnabled: true,
      subscriptionPlanId: null,
      subscriptionPlanName: "Professional",
      assistantsPerUserLimit: 8,
      assistantsUsedByCurrentUser: 5,
      orgPlan: "pro",
      trialEndsAt: null,
      orgLogoUrl: null,
      brandName: "VERIDIAN AI OS",
      orgBrandPrimaryColor: "#1C2B3A",
      orgBrandAccentColor: "#F5820A",
    })
  })

  test("a stage-0 user with no orgId skips every org-scoped lookup and still returns 200", async () => {
    await mockAllDependencies(null, { id: "user-1", role: "member" })
    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orgId).toBeNull()
    expect(body.pmsEnabled).toBe(false)
    expect(body.assistantsUsedByCurrentUser).toBe(5) // still resolved from dbUser.id alone
  })
})
