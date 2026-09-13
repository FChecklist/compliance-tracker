// R80/81/82 CI investigation (PR #1723): requireErpEnabled() had NO
// memoization at all -- unlike construction-reports-service.ts's
// ensureConstructionEnabled() (R67 F-10/R75 Part 3), which already gets a
// 60s-per-org memo with in-flight-promise dedup for the identical reason.
// isErpEnabledForOrg() opens its OWN withTenantContext transaction (via
// isBranchEnabledForOrg, product-branch-service.ts) on the shared,
// application-wide max:5 app_runtime pool -- so every one of
// listSuppliers()/listCurrencies()/every other ERP-gated call spent a
// SECOND pooled connection re-answering "does this org have ERP?" on top of
// its own real query's connection. Confirmed as a real, live contributor to
// PR #1723's own e2e-env1 job (run 34749520515, job 103703691366) failures
// once a separate, unrelated PROJEXA_DATABASE_URL credential bug was fixed
// and compliance-tracker's backend became reachable for the first time.
//
// This mirrors construction-reports-service.test.ts's own "enablement memo"
// describe block (R67 F-10 acceptance test) applied to the ONE enablement
// check that never got the same treatment: isErpEnabledForOrgMemoized() /
// requireErpEnabled(). Same four assertions, same shape:
//   (a) two consecutive calls for the same org inside the TTL check the
//       underlying branch-enablement lookup ONCE;
//   (a2) concurrent callers for the same org share the one in-flight check
//       (rather than each opening their own transaction);
//   (a3) a DIFFERENT org is never served another org's memoised answer;
//   (a4) a REFUSAL is never memoised -- an org that has just purchased ERP
//       must see it immediately, not up to 60s later.
//
// Mocks only product-branch-service.ts's isBranchEnabledForOrg (the one real
// DB-touching call this file makes) -- no live DB, but the real
// isErpEnabledForOrgMemoized()/requireErpEnabled() code path under test.
import { describe, expect, test, mock, afterEach } from "bun:test"

const realBranchService = await import("./product-branch-service")

describe("erp-enablement-service: requireErpEnabled() memoization (R80/81/82)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("./product-branch-service", () => realBranchService)
  })

  async function loadServiceWithSpy(enabled: boolean) {
    const isBranchEnabledForOrgSpy = mock(async (_orgId: string, _branchKey: string) => enabled)
    await mock.module("./product-branch-service", () => ({
      ...realBranchService,
      isBranchEnabledForOrg: isBranchEnabledForOrgSpy,
    }))

    const service = await import("./erp-enablement-service")
    service.__resetErpEnablementMemo()
    return { service, isBranchEnabledForOrgSpy }
  }

  test("(a) two consecutive requireErpEnabled() calls for the same org inside the TTL check enablement ONCE", async () => {
    const { service, isBranchEnabledForOrgSpy } = await loadServiceWithSpy(true)

    await service.requireErpEnabled("org-memo")
    await service.requireErpEnabled("org-memo")

    expect(isBranchEnabledForOrgSpy.mock.calls.length).toBe(1)
  })

  test("(a2) concurrent requireErpEnabled() calls for the same org share the one in-flight check", async () => {
    const { service, isBranchEnabledForOrgSpy } = await loadServiceWithSpy(true)

    await Promise.all([
      service.requireErpEnabled("org-concurrent"),
      service.requireErpEnabled("org-concurrent"),
      service.requireErpEnabled("org-concurrent"),
    ])

    expect(isBranchEnabledForOrgSpy.mock.calls.length).toBe(1)
  })

  test("(a3) a DIFFERENT org is never served another org's memoised answer", async () => {
    const { service, isBranchEnabledForOrgSpy } = await loadServiceWithSpy(true)

    await service.requireErpEnabled("org-one")
    await service.requireErpEnabled("org-two")

    expect(isBranchEnabledForOrgSpy.mock.calls.length).toBe(2)
  })

  test("(a4) a REFUSAL is never memoised -- an org that has just enabled ERP is not told 'no' for a minute", async () => {
    const { service, isBranchEnabledForOrgSpy } = await loadServiceWithSpy(false)

    await expect(service.requireErpEnabled("org-blocked")).rejects.toThrow(/Module your organization purchased/)
    await expect(service.requireErpEnabled("org-blocked")).rejects.toThrow(/Module your organization purchased/)

    expect(isBranchEnabledForOrgSpy.mock.calls.length).toBe(2)
  })

  test("(b) requireErpEnabled() resolves once the org is actually enabled", async () => {
    const { service } = await loadServiceWithSpy(true)

    await expect(service.requireErpEnabled("org-ok")).resolves.toBeUndefined()
  })
})
