// Audit 37 point 11 ("our AI is used only if we allow"): the PER-ORGANISATION allow flag for the internal AI, default OFF (closed).
//
// The deployment switch (PROJEXA_INTERNAL_AI_ENABLED, projexa-internal-ai.ts) stays the MASTER OFF: it is checked first and nothing in
// this file can turn the internal AI on when it is off. This file adds the second condition: even with the master on, an organisation
// is served by our AI only if it has been allowed.
//
// MECHANISM. The existing product-branch entitlement substrate, no new table or column: a catalog row platform.product_branches
// branch_key = 'internal_ai' (data-only migration 0692) and, per organisation, a compliance.org_product_branch_enablements row with
// is_enabled = true, exactly like every other separately entitled capability (isBranchEnabledForOrg). No row, a disabled row, a
// branch that is not registered yet (migration not applied), or any lookup error all read as NOT allowed: fail closed.
//
// NESTING. Use the WithDb variant when a tenant transaction is already open (tenant-scoped.ts assertNotNested); the plain variant
// opens its own.
import { isBranchEnabledForOrgWithDb, isBranchEnabledForOrg } from "@/lib/services/product-branch-service"
import type { TenantDb } from "@/lib/db/tenant-scoped"

/** The product-branch key an organisation is entitled to in order to be served by our own AI. */
export const INTERNAL_AI_BRANCH_KEY = "internal_ai"

/** Is this organisation allowed our AI? Uses an already-open tenant transaction. Never throws: any failure is "not allowed". */
export async function isInternalAiAllowedForOrgWithDb(db: TenantDb, orgId: string): Promise<boolean> {
  if (!orgId) return false
  try {
    return (await isBranchEnabledForOrgWithDb(db, orgId, INTERNAL_AI_BRANCH_KEY)) === true
  } catch {
    return false
  }
}

/** Same, opening its own tenant transaction. Do not call from inside an open withTenantContext block. */
export async function isInternalAiAllowedForOrg(orgId: string): Promise<boolean> {
  if (!orgId) return false
  try {
    return (await isBranchEnabledForOrg(orgId, INTERNAL_AI_BRANCH_KEY)) === true
  } catch {
    return false
  }
}
