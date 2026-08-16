// Org-level enablement of the 'veri_chat_v2' product branch -- thin wrapper
// over product-branch-service.ts, mirroring pms-enablement-service.ts's
// exact shape (the reference implementation for this pattern). No seedFn:
// enabling this branch doesn't need to create any org-owned rows, it just
// changes which composer/panel components AppShell mounts.
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export type VeriChatV2Context = BranchEnablementContext

const BRANCH_KEY = "veri_chat_v2"

export async function isVeriChatV2EnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, BRANCH_KEY)
}

/** Shared 403 gate for any future veri-chat-v2-only service/route. */
export async function requireVeriChatV2Enabled(orgId: string): Promise<void> {
  if (!(await isVeriChatV2EnabledForOrg(orgId))) {
    throw new ServiceError("VERI Chat (persistent composer) is not enabled for this organisation", 403)
  }
}

export async function getVeriChatV2Enablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, BRANCH_KEY)
}

export async function enableVeriChatV2ForOrg(ctx: VeriChatV2Context) {
  return enableProductBranchForOrg(ctx, BRANCH_KEY)
}

export async function disableVeriChatV2ForOrg(ctx: VeriChatV2Context) {
  return disableProductBranchForOrg(ctx, BRANCH_KEY)
}
