// Gap closure, 2026-07-09 (CRITICAL_GAPS.md #2 / AUDIT_2026-07-09.md): the
// access-control primitive The Firm module (and any future per-client
// module) needs but never had wired up. `user_client_access` (Wave 1) and
// `withTenantContext`'s `clientIds` GUC plumbing both already existed --
// the missing piece was a single place that resolves "which clients can
// this user actually see" and something that actually calls it.
//
// Product decision (Boss-delegated, 2026-07-09): branch_manager and above
// (branch_manager/admin/veridian_admin, ROLE_RANK >= 4) see every client in
// their org by default -- they run the practice. Everyone below that rank
// is restricted to clients they have an explicit `user_client_access` row
// for. A user with zero grants sees zero clients -- fail closed, matching
// this codebase's existing posture everywhere else (a forgotten WHERE
// clause still gets filtered by RLS, not silently opened up).
import { clients, userClientAccess, type users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"

export const FULL_CLIENT_ACCESS_ROLE = "branch_manager"

/**
 * Resolves the full list of client ids `dbUser` may see within `orgId`,
 * for passing into `withTenantContext({ clientIds })`. Runs its own
 * `withTenantContext({ orgId })` transaction -- `clients` and
 * `user_client_access` are both purely org-scoped tables (confirmed live:
 * neither policy depends on `current_client_ids()` itself), so this has no
 * circularity with the value it's computing.
 */
export async function resolveAccessibleClientIds(
  orgId: string,
  dbUser: typeof users.$inferSelect | null
): Promise<string[]> {
  if (!dbUser) return []

  return withTenantContext({ orgId }, async (db) => {
    if (hasRole(dbUser, FULL_CLIENT_ACCESS_ROLE)) {
      const rows = await db.query.clients.findMany({ where: eq(clients.orgId, orgId), columns: { id: true } })
      return rows.map((r) => r.id)
    }
    const rows = await db.query.userClientAccess.findMany({
      where: eq(userClientAccess.userId, dbUser.id),
      columns: { clientId: true },
    })
    return rows.map((r) => r.clientId)
  })
}
