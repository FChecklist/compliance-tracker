// P6 (aims 5-6): the OWNER-FACING half of the per-organisation internal-AI allow flag. internal-ai-org-allowance.ts only READS
// the flag (compliance.org_product_branch_enablements, branch_key 'internal_ai', migration 0692); this file lets an organisation's
// owner/admin switch it. Default is OFF (no row = closed). The change is stamped with who and when through the columns that table
// already has (enabled_by_id, enabled_at, disabled_at) -- no new table or column.
//
// Deliberately NOT enableProductBranchForOrg(): that function also runs the stage-0 auto-upgrade, a paid-branch side effect that has
// nothing to do with switching an AI permission. The master deployment switch PROJEXA_INTERNAL_AI_ENABLED stays the master off
// (internal-ai-org-allowance.ts header): this flag can never turn the internal AI on when that switch is off.
import { orgProductBranchEnablements, productBranches } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/role-rank"
import { INTERNAL_AI_BRANCH_KEY } from "./internal-ai-org-allowance"

export class InternalAiAllowanceError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export type InternalAiAllowanceState = { allowed: boolean; changedAt: string | null; changedById: string | null }
type Actor = { orgId: string; userId: string; dbUser: { role: string } }

/** Current state for the organisation. Fail closed: a branch not registered yet reads as not allowed. */
export async function getInternalAiAllowance(orgId: string): Promise<InternalAiAllowanceState> {
  return withTenantContext({ orgId }, async (db) => {
    const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, INTERNAL_AI_BRANCH_KEY) })
    if (!branch) return { allowed: false, changedAt: null, changedById: null }
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, orgId), eq(orgProductBranchEnablements.productBranchId, branch.id)),
    })
    if (!row) return { allowed: false, changedAt: null, changedById: null }
    const when = row.isEnabled ? row.enabledAt : row.disabledAt
    return { allowed: row.isEnabled === true, changedAt: when ? new Date(when).toISOString() : null, changedById: row.enabledById ?? null }
  })
}

/** Switch it. Admin (the organisation owner/admin role) or higher only; also enforced by the route. */
export async function setInternalAiAllowance(actor: Actor, allowed: boolean): Promise<InternalAiAllowanceState> {
  if (!hasRole(actor.dbUser, "admin")) throw new InternalAiAllowanceError("Only an organisation owner or admin can change this", 403)
  return withTenantContext({ orgId: actor.orgId, userId: actor.userId }, async (db) => {
    const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, INTERNAL_AI_BRANCH_KEY) })
    if (!branch) throw new InternalAiAllowanceError("This option is not available yet", 409)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, actor.orgId), eq(orgProductBranchEnablements.productBranchId, branch.id)),
    })
    const now = new Date()
    if (existing) {
      await db
        .update(orgProductBranchEnablements)
        .set(allowed
          ? { isEnabled: true, enabledAt: now, enabledById: actor.userId, disabledAt: null, updatedAt: now }
          : { isEnabled: false, disabledAt: now, enabledById: actor.userId, updatedAt: now })
        .where(eq(orgProductBranchEnablements.id, existing.id))
    } else if (allowed) {
      await db.insert(orgProductBranchEnablements).values({
        orgId: actor.orgId, productBranchId: branch.id, isEnabled: true, enabledAt: now, enabledById: actor.userId,
      })
    }
    // Switching off when no row exists changes nothing: it already reads as off.
    return { allowed, changedAt: now.toISOString(), changedById: actor.userId }
  })
}
