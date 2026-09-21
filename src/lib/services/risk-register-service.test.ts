/// <reference types="bun-types" />
// PROJEXA-E2E-001 cold-load investigation, continuation (2026-09-21):
// getGrcDashboard() used to call listRisks/listAuditEngagements/
// listPolicies/listVendorRiskProfiles directly via Promise.all, each of
// which opened its OWN withTenantContext -- four separate concurrent
// connections/transactions borrowed from the same 5-connection pool for one
// dashboard read (/grc's default "Dashboard" tab, GET /api/grc-dashboard ->
// GET /api/v1/projexa/grc-dashboard). Fixed the same way
// construction-dashboard-service.ts's getOrgDashboardWithDb /
// task-execution-engine.ts's dispatchTool() were fixed for the analogous
// nested-transaction regression (see that fix's own
// src/app/api/v1/projexa/assistant/route.test.ts, R-80) -- this file copies
// its withTenantContext call-depth/call-count tracker technique, adapted
// from "never nests" to "never fans out to more than one concurrent
// transaction for one dashboard read".
//
// Falsifiability, personally proven: temporarily reverted getGrcDashboard()
// back to calling the old self-opening listRisks/listAuditEngagements/
// listPolicies/listVendorRiskProfiles, reran this file, confirmed
// "expect(getCallCount()).toBe(1)" failed with callCount 4 as expected, then
// restored the fix and confirmed green again.
import { describe, test, expect, mock } from "bun:test"

mock.module("@/lib/module-rules-resolver", () => ({
  // listRisksWithDb's own severity-matrix lookup -- a real, separate
  // withTenantContext caller this fix deliberately leaves untouched (see
  // risk-register-service.ts's own comment on getGrcDashboard). Stubbed out
  // here so this test's call-count assertion is only about the fan-out this
  // fix actually closes, not about a dependency it doesn't touch.
  resolveModuleRule: mock(async () => null),
}))

/**
 * Counts how many times withTenantContext is invoked, and how many were
 * concurrently open at once (depth) -- the same construction as
 * assistant/route.test.ts's makeDepthTracker(), but this fix's real claim is
 * about CALL COUNT (fan-out), not nesting depth, so both are asserted.
 */
function makeTracker() {
  let depth = 0
  let maxDepth = 0
  let callCount = 0
  const fakeDb = { __fakeDb: true }
  const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    callCount += 1
    depth += 1
    maxDepth = Math.max(maxDepth, depth)
    try {
      return await fn(fakeDb)
    } finally {
      depth -= 1
    }
  })
  return { withTenantContext, getMaxDepth: () => maxDepth, getCallCount: () => callCount, fakeDb }
}

const RISK_ROW = {
  id: "risk-1", title: "Vendor concentration", category: "operational",
  likelihood: 4, impact: 4, status: "open", ownerId: null, ownerDept: null,
  linkedControlIds: [], updatedAt: new Date("2026-09-01T00:00:00Z"),
}
const ENGAGEMENT_ROW = {
  id: "eng-1", name: "Q3 internal audit", auditType: "internal", status: "in_progress",
  coversRiskIds: ["risk-1"],
  findings: [
    { id: "f-1", title: "Missing sign-off", severity: "medium", capaStatus: "open", ownerId: null, dueDate: null, retestResult: null },
  ],
}
const POLICY_ROW = {
  id: "pol-1", title: "Data retention policy", category: "data", version: 2,
  status: "published", attestationRate: 80, history: [],
}
const VENDOR_ROW = {
  id: "ven-1", name: "Acme Supplies", riskTier: "high", riskScore: 72,
  riskFactors: ["single-source"], certifications: [], lastAssessedDate: null,
}

function fakeDbQuery() {
  return {
    query: {
      risks: { findMany: mock(async () => [RISK_ROW]) },
      auditEngagements: { findMany: mock(async () => [ENGAGEMENT_ROW]) },
      policies: { findMany: mock(async () => [POLICY_ROW]) },
      vendorRiskProfiles: { findMany: mock(async () => [VENDOR_ROW]) },
    },
  }
}

describe("getGrcDashboard -- cold-load fix: one shared transaction, not four", () => {
  test("opens withTenantContext exactly once (never more than one concurrently) for the whole dashboard read", async () => {
    const { withTenantContext, getMaxDepth, getCallCount } = makeTracker()
    const db = fakeDbQuery()
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
        // Delegate to the tracker but hand the fn a db object with real
        // .query.* mocks (the tracker's own fakeDb has none) so
        // listRisksWithDb/listAuditEngagementsWithDb/listPoliciesWithDb/
        // listVendorRiskProfilesWithDb can actually run against it.
        return withTenantContext(ctx, async () => fn(db))
      }),
    }))

    const { getGrcDashboard } = await import("./risk-register-service")
    const result = await getGrcDashboard({ orgId: "org-1" })

    // The real regression this test exists to catch: before this fix,
    // callCount was 4 (one withTenantContext per list function) and a
    // concurrent Promise.all of them meant maxDepth could reach 4 too.
    expect(getCallCount()).toBe(1)
    expect(getMaxDepth()).toBe(1)

    // Each underlying table was still queried exactly once -- the fix
    // shares the CONNECTION, it does not drop or duplicate any read.
    expect(db.query.risks.findMany).toHaveBeenCalledTimes(1)
    expect(db.query.auditEngagements.findMany).toHaveBeenCalledTimes(1)
    expect(db.query.policies.findMany).toHaveBeenCalledTimes(1)
    expect(db.query.vendorRiskProfiles.findMany).toHaveBeenCalledTimes(1)

    // The actual requirement: the rollup still computes correctly from all
    // four sources, not just "fewer transactions".
    expect(result.risks.openCount).toBe(1)
    expect(result.risks.totalCount).toBe(1)
    expect(result.audit.engagementCount).toBe(1)
    expect(result.audit.openFindingsCount).toBe(1)
    expect(result.policies.publishedCount).toBe(1)
    expect(result.vendorRisk.totalCount).toBe(1)
    expect(result.vendorRisk.highTierCount).toBe(1)
  })
})
