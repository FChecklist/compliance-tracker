// Wave 26 (VERIDIAN AI PMS) service layer -- org-level enablement of the
// 'pms' product branch. Every other PMS service/route calls
// requirePmsEnabled() as its first gate; enabling seeds real, org-owned
// default issue types (copy-on-enable, per PLATFORM_STRATEGY.md §14 -- not
// a live-resolved platform catalog). Disabling never deletes data.
//
// Wave 106 (Master AI OS Registry): this file is now a thin wrapper over
// the generic product-branch-service.ts -- PMS was the reference
// implementation the generic enable/disable/require functions were
// extracted from, so every export below keeps its exact original name and
// signature (every one of the 29 PMS routes importing from this file is
// untouched). Only the default-issue-type seeding is PMS-specific; it's
// now passed in as a seedFn rather than inlined.
import { pmsIssueTypes } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export type PmsContext = BranchEnablementContext

const DEFAULT_ISSUE_TYPES = [
  { name: "Task", icon: "check-square", isEpic: false, isDefault: true },
  { name: "Bug", icon: "bug", isEpic: false, isDefault: false },
  { name: "Story", icon: "bookmark", isEpic: false, isDefault: false },
  { name: "Epic", icon: "layers", isEpic: true, isDefault: false },
]

// Copy-on-enable: seed org-owned default issue types, only if this org has
// none yet (re-enabling after a disable must not duplicate them).
async function seedDefaultIssueTypes(db: TenantDb, orgId: string): Promise<void> {
  const existingTypes = await db.query.pmsIssueTypes.findMany({ where: eq(pmsIssueTypes.orgId, orgId) })
  if (existingTypes.length === 0) {
    await db.insert(pmsIssueTypes).values(DEFAULT_ISSUE_TYPES.map((t) => ({ orgId, ...t })))
  }
}

export async function isPmsEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "pms")
}

/** Shared 403 gate every PMS service/route calls first. */
export async function requirePmsEnabled(orgId: string): Promise<void> {
  if (!(await isPmsEnabledForOrg(orgId))) {
    throw new ServiceError("VERIDIAN AI PMS is not enabled for this organisation", 403)
  }
}

export async function getPmsEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "pms")
}

export async function enablePmsForOrg(ctx: PmsContext) {
  return enableProductBranchForOrg(ctx, "pms", seedDefaultIssueTypes)
}

export async function disablePmsForOrg(ctx: PmsContext) {
  return disableProductBranchForOrg(ctx, "pms")
}
