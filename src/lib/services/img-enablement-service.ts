// R68 (Institutional Memory Graph) Phase 8, IMG-031: org-level enablement of
// the `institutional_memory` product branch (drizzle/0547).
//
// This file is the same thin wrapper shape as erp-enablement-service.ts /
// construction-enablement-service.ts / fm-enablement-service.ts, over the same
// generic product-branch-service.ts primitives. It is NOT a new mechanism, and
// there is deliberately no IMG-specific notion of "enabled" anywhere in it.
//
// ─── HOW THIS RELATES TO memory-entitlement.ts ──────────────────────────
//
// Two callers, two shapes, ONE truth:
//
//   - OUTSIDE a transaction (an admin route enabling the product, a UI asking
//     "does this org have IMG?"): use this file. It goes through
//     withTenantContext() like every other vertical's wrapper.
//   - INSIDE an already-open transaction (every real recall and write path,
//     all of which already receive a `tx`): use memory-entitlement.ts's
//     assertImgEntitled(tx). Calling isImgEnabledForOrg() from in there would
//     open a SECOND connection out of a pool of five -- the exact
//     construction-dashboard chain that parked all five app_runtime sessions
//     "idle in transaction" for 25 minutes on 2026-09-02, and which
//     tenant-scoped.ts's nesting guard now throws on in dev and test.
//
// Both read platform.product_branches and
// compliance.org_product_branch_enablements, both honour
// organisations.primary_product_branch_id, and both use the same
// IMG_BRANCH_KEY constant. The split is about which connection the question is
// asked on, never about what the answer is.
//
// ─── WHY THERE IS NO seedFn ─────────────────────────────────────────────
//
// PMS seeds default issue types on enable and ERP seeds a fiscal year and a
// chart of accounts, because those verticals are unusable with empty master
// data. IMG has no equivalent: an org's institutional memory starts genuinely
// empty and fills from that org's own real work (run-submission.ts's task
// results, chat-service.ts's memorable statements, Phase 7's Sheets
// projection). Seeding platform-authored rows into compliance.memory_records
// would be the opposite of what this product is -- it would put facts the
// organisation never stated into the organisation's own memory, and Phase 6's
// attribution rules have no honest originator to record for them.
//
// ─── PER-TENANT ONLY (IMG-032, owner decision 2026-09-03) ───────────────
//
// Enabling IMG for an org grants that org access to its OWN memory and nothing
// else. There is no pooling, no cross-org corpus, and no shared model: the
// entitlement is a gate on org-scoped reads and writes, never a join across
// tenants. Cross-tenant learning is limited to STRUCTURE (extraction profiles,
// phrase maps, taxonomies, chunking policies) and is disclosed in the DPA;
// nothing in this file or in memory-entitlement.ts reads, aggregates, or
// trains on another org's content.
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
import { IMG_BRANCH_KEY, IMG_NOT_ENTITLED_MESSAGE } from "./memory-entitlement"
export { ServiceError }
export { IMG_BRANCH_KEY, IMG_NOT_ENTITLED_MESSAGE }

export type ImgContext = BranchEnablementContext

/** Opens its own transaction -- never call this from inside one. See the header. */
export async function isImgEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, IMG_BRANCH_KEY)
}

/**
 * Shared 403 gate for callers that are NOT already inside a transaction.
 * The in-transaction equivalent is memory-entitlement.ts's assertImgEntitled().
 * Same message, same underlying rows.
 */
export async function requireImgEnabled(orgId: string): Promise<void> {
  if (!(await isImgEnabledForOrg(orgId))) {
    throw new ServiceError(IMG_NOT_ENTITLED_MESSAGE, 403)
  }
}

export async function getImgEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, IMG_BRANCH_KEY)
}

export async function enableImgForOrg(ctx: ImgContext) {
  return enableProductBranchForOrg(ctx, IMG_BRANCH_KEY)
}

export async function disableImgForOrg(ctx: ImgContext) {
  return disableProductBranchForOrg(ctx, IMG_BRANCH_KEY)
}
