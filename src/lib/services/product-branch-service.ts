// Wave 106 (Master AI OS Registry): generic product-branch enablement,
// extracted from pms-enablement-service.ts's original PMS-only
// implementation. Every current and future "VERI X AI OS" vertical
// enables/disables itself through these functions, never a bespoke
// per-vertical copy -- see MASTER_AI_OS_ARCHITECTURE.md's module-reuse and
// branch-key rules for why. pms-enablement-service.ts is now a thin
// wrapper over this file with branchKey: "pms".
import { db, orgProductBranchEnablements, organisations, productBranches } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type BranchEnablementContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Copy-on-enable seeding is domain-specific (PMS seeds default issue types;
// a future vertical might seed nothing, or its own defaults) -- the
// generic enable function never knows what to seed, only that it should
// call back into whatever the vertical provides. Each seedFn owns its own
// idempotency check (PMS's own pattern: "only seed if this org has none
// yet"), since re-enabling after a disable must never duplicate rows.
export type BranchSeedFn = (db: TenantDb, orgId: string) => Promise<void>

async function getBranchId(db: TenantDb, branchKey: string): Promise<string> {
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, branchKey) })
  if (!branch) throw new ServiceError(`Product branch '${branchKey}' is not registered`, 500)
  return branch.id
}

// Lint-style guard for the layerKey namespacing convention (Master AI OS
// rule #5) -- not a DB constraint, since orchestraLayers.layerKey has none
// today and adding one is out of scope for this wave. Callers seeding a
// new orchestra layer for a vertical should call this before inserting.
export function assertValidLayerKey(branchKey: string, layerKey: string): void {
  if (!layerKey.startsWith(`${branchKey}_`)) {
    throw new ServiceError(
      `Orchestra layer key '${layerKey}' must be namespaced as '${branchKey}_<agent>_oa' per MASTER_AI_OS_ARCHITECTURE.md`,
      500
    )
  }
}

// R74 Phase 10 fix: the actual check, pulled out so a caller that ALREADY
// holds an open withTenantContext transaction (e.g. capability-tree-service
// .ts's buildCapabilityTree(), via getFullReportCatalog's per-domain
// isReportDomainEnabledForOrg calls) can pass that same `db` handle down
// instead of opening a second one -- see tenant-scoped.ts's own
// assertNotNested() error message ("Pass the open transaction's db handle
// down instead"). Confirmed live: this was the second of two real, direct
// nested-withTenantContext call sites inside buildCapabilityTree's single
// synchronous chain (the first was getFullReportCatalog's own transaction,
// fixed alongside this one) -- both reproduced GET /api/v1/projexa/
// module-chain's "nested withTenantContext" error on every call, not
// intermittently, because both are real, deterministic nesting in the
// source, not a timing-dependent race.
export async function isBranchEnabledForOrgWithDb(db: TenantDb, orgId: string, branchKey: string): Promise<boolean> {
  const branchId = await getBranchId(db, branchKey)
    // Wave 7 (CRM+PROJEXA-merge plan, 2026-07-21): an org whose entire
    // brand identity IS this branch (organisations.primaryProductBranchId
    // -- the same field org-branding-service.ts's resolveBranding() reads
    // for brandName, Wave 5) is inherently enabled for it, with no
    // separate paid-add-on enablement row required. This is the real fix
    // for a reconciling gap the CRM+PROJEXA module-mapping report flagged:
    // PROJEXA's own /v1/projexa/schedule|board/** routes deliberately
    // never call requirePmsEnabled() (see that route's own comment --
    // "pms_issues is PROJEXA's generic task/schedule substrate, not gated
    // behind the separately-purchased PMS product branch"), while this
    // repo's OWN /pms/[projectId]/* UI does gate on it -- so a PROJEXA-
    // branded org could reach the data via PROJEXA's frontend but not via
    // this repo's own equivalent page. A PROJEXA-branded org's whole
    // product IS project management; requiring them to also separately
    // "buy" the pms branch on top of their own brand identity would be
    // charging twice for the same thing. GRC-only orgs that separately
    // enable pms as an add-on are completely unaffected -- this only ever
    // ADDS an enabled=true outcome on top of the existing row-based check,
    // never removes one.
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.id, orgId),
      columns: { primaryProductBranchId: true },
    })
    if (org?.primaryProductBranchId === branchId) return true
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return row?.isEnabled ?? false
}

export async function isBranchEnabledForOrg(orgId: string, branchKey: string): Promise<boolean> {
  return withTenantContext({ orgId }, (db) => isBranchEnabledForOrgWithDb(db, orgId, branchKey))
}

/** Shared 403 gate every vertical's service/route calls first. */
export async function requireBranchEnabled(orgId: string, branchKey: string): Promise<void> {
  if (!(await isBranchEnabledForOrg(orgId, branchKey))) {
    throw new ServiceError(`This product branch is not enabled for this organisation`, 403)
  }
}

// VERIDIAN Review Framework gap-closure (2026-08-07): the "for every org
// that has this branch enabled" cross-org query every scheduled
// /api/internal/*\/run job needs (e.g. crm-lead-scoring, matching the
// "iterate every org, best-effort per org" shape refreshLiveExchangeRatesForAllOrgs()
// already uses over erpCurrencies). Raw `db`, not tenant-scoped -- this is
// a platform job with no single org in context, same posture as every
// other cross-org cron in this codebase.
export async function listOrgIdsWithBranchEnabled(branchKey: string): Promise<string[]> {
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, branchKey) })
  if (!branch) return []
  const rows = await db.query.orgProductBranchEnablements.findMany({
    where: and(eq(orgProductBranchEnablements.productBranchId, branch.id), eq(orgProductBranchEnablements.isEnabled, true)),
    columns: { orgId: true },
  })
  return rows.map((r) => r.orgId)
}

export async function getBranchEnablement(ctx: { orgId: string }, branchKey: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return { isEnabled: row?.isEnabled ?? false, enabledAt: row?.enabledAt ?? null, disabledAt: row?.disabledAt ?? null }
  })
}

/**
 * What the stage-0 auto-upgrade did, INCLUDING when it did nothing because it
 * failed. `failed` is the G-26 half: the upgrade is deliberately non-blocking,
 * so without a field for it a failure and a no-op are the same response, and
 * the two UI surfaces that read this cannot tell a customer which happened.
 */
export type Stage0AutoUpgradeOutcome =
  | { upgraded: number; blocked: number; failed?: false; reason?: never }
  | { upgraded: 0; blocked: 0; failed: true; reason: string }

export async function enableProductBranchForOrg(ctx: BranchEnablementContext, branchKey: string, seedFn?: BranchSeedFn) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Enabling a product branch requires admin role or higher", 403)

  const enabled = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })

    const now = new Date()
    if (existing) {
      await db.update(orgProductBranchEnablements)
        .set({ isEnabled: true, enabledAt: now, enabledById: ctx.userId, disabledAt: null, updatedAt: now })
        .where(eq(orgProductBranchEnablements.id, existing.id))
    } else {
      await db.insert(orgProductBranchEnablements).values({
        orgId: ctx.orgId, productBranchId: branchId, isEnabled: true, enabledAt: now, enabledById: ctx.userId,
      })
    }

    if (seedFn) await seedFn(db, ctx.orgId)

    return { isEnabled: true as const, enabledAt: now.toISOString() }
  })

  // Priority 18b (Owner directive 2026-07-15, Option B, auto-upgrade Trigger
  // B): this is the single real chokepoint every enable*ForOrg wrapper in this
  // codebase routes through (erp/pms/construction/crm/firm/fm/veri_chat_v2/
  // veri_reward-enablement-service.ts), so hooking in here fires no matter
  // which vertical's paid branch gets enabled, present or future.
  //
  // G-26 -- HOISTED OUT OF THE TRANSACTION ABOVE, and this is a fix, not a
  // tidy-up. It used to run INSIDE that withTenantContext with the handle
  // threaded in. Threading looked right and could never have worked, because
  // the chain ends at subscription-plan-service.ts provisionAiAssistantsForUser,
  // which inserts compliance.ai_assistants rows FOR THE USER BEING UPGRADED.
  // That table has FORCE ROW LEVEL SECURITY with
  //   app_runtime_owner_only  USING (user_id = compliance.current_user_id())
  // and the enclosing transaction carries the ADMIN who triggered the enable.
  // So the insert was denied by policy for every user who was not the admin.
  //
  // WHAT THAT MEANT IN PRACTICE, both ways, and neither was visible:
  //   dev/test    assertNotNested THREW, into the catch below -> no stage-0
  //               user was ever auto-upgraded.
  //   production  the guard only warns, so the call proceeded under the
  //               admin's identity -> the RLS policy denied the insert -> that
  //               denial ALSO landed in the catch below. The branch was
  //               enabled with the upgrade half-applied and nothing said so.
  // Registering this as a known-open nesting site (ROOT CAUSE D) was wrong: it
  // is not a pool-pressure trade-off awaiting a ruling, it is a defect that is
  // failing now. Hoisting lets provisionAiAssistantsForUser open its own
  // transaction under the PROVISIONED user's identity, which is the only
  // context the policy accepts.
  //
  // The enable itself has already COMMITTED by this point, so this still must
  // not throw -- failing the whole call after the branch is enabled would
  // report a failure for work that succeeded. It stays non-blocking, the same
  // posture org-provisioning-service.ts uses. What changes is that a failure is
  // no longer silent: it is logged at ERROR and RETURNED, so the caller and the
  // two UI surfaces that read stage0AutoUpgrade can say the upgrade did not
  // happen instead of implying it did.
  let stage0AutoUpgrade: Stage0AutoUpgradeOutcome | undefined
  try {
    const { autoUpgradeStage0UsersOnBranchEnable } = await import("./stage0-service")
    stage0AutoUpgrade = await autoUpgradeStage0UsersOnBranchEnable(ctx.orgId)
  } catch (err) {
    console.error("Stage-0 auto-upgrade on branch enable FAILED (branch stays enabled):", err)
    stage0AutoUpgrade = {
      upgraded: 0,
      blocked: 0,
      failed: true,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  return { ...enabled, stage0AutoUpgrade }
}

export async function disableProductBranchForOrg(ctx: BranchEnablementContext, branchKey: string) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Disabling a product branch requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    if (!existing) throw new ServiceError("This product branch was never enabled for this organisation", 404)

    const now = new Date()
    await db.update(orgProductBranchEnablements)
      .set({ isEnabled: false, disabledAt: now, updatedAt: now })
      .where(eq(orgProductBranchEnablements.id, existing.id))

    return { isEnabled: false, disabledAt: now.toISOString() }
  })
}
