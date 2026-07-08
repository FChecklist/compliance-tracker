// Wave 113 (VERI Treasure) -- org-level enablement of the 'veri_reward'
// product branch. Thin wrapper over product-branch-service.ts, following
// the exact shape firm-enablement-service.ts/fm-enablement-service.ts/
// pms-enablement-service.ts already demonstrate.
//
// Unlike PMS/THE FIRM (opt-in), this branch defaults to enabled for every
// org: the 0098_veri_reward_branch.sql migration backfills every existing
// org, and autoProvisionUser() (src/lib/supabase/auth-guard.ts) enables it
// for every new org at signup time. The requireVeriRewardEnabled() gate
// still exists (unlike 'office', which has no runtime gate at all) so an
// org can genuinely opt out later without that toggle being a no-op.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export const VERI_REWARD_BRANCH_KEY = "veri_reward"

export type VeriRewardContext = BranchEnablementContext

// No org-owned defaults to seed on enable -- platform-default achievement
// definitions (org_id IS NULL rows) are already visible to every org via
// checkAndUnlockAchievements()'s scope-resolution fallback, nothing to copy.
async function seedNothing(_db: TenantDb, _orgId: string): Promise<void> {
  /* no-op */
}

export async function isVeriRewardEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, VERI_REWARD_BRANCH_KEY)
}

/** Shared 403 gate every VERI Treasure service/route calls first. */
export async function requireVeriRewardEnabled(orgId: string): Promise<void> {
  if (!(await isVeriRewardEnabledForOrg(orgId))) {
    throw new ServiceError("VERI TREASURE is not enabled for this organisation", 403)
  }
}

export async function getVeriRewardEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, VERI_REWARD_BRANCH_KEY)
}

export async function enableVeriRewardForOrg(ctx: VeriRewardContext) {
  return enableProductBranchForOrg(ctx, VERI_REWARD_BRANCH_KEY, seedNothing)
}

export async function disableVeriRewardForOrg(ctx: VeriRewardContext) {
  return disableProductBranchForOrg(ctx, VERI_REWARD_BRANCH_KEY)
}
