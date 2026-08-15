import { NextRequest, NextResponse } from "next/server"
import { db, organisations, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { validateSupportSessionToken } from "@/lib/services/support-session-service"
import { logActivity } from "@/lib/audit"

// Proves the whole mechanism actually threads through: a caller presenting
// a valid `Authorization: Bearer ss_...` token (same convention as
// api-key-auth.ts's `Bearer vk_...`) gets back who they're impersonating,
// via a REAL tenant-scoped read (withTenantContext, same RLS path every
// other route uses -- not a lookup on the raw client) plus a REAL
// audit_logs row carrying support_session_id/acting_on_behalf_of_user_id,
// so this row is indistinguishable in shape from any other logged action
// except for those two columns being set.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const validated = await validateSupportSessionToken(token)
  if (!validated) return NextResponse.json({ error: "Invalid or expired support session" }, { status: 401 })

  const { row: session } = validated

  // The REAL actor is the support agent who started the session, never the
  // impersonated target user -- fetched via the raw (RLS-bypassing) client
  // because the agent's own user row lives in a DIFFERENT org than the one
  // this request's tenant context is about to be scoped to (users' own RLS
  // policy would otherwise hide it). acting_on_behalf_of_user_id (set below)
  // is what records the impersonated identity -- see audit.ts's
  // supportSession param.
  const initiator = await db.query.users.findFirst({ where: eq(users.id, session.initiatedByUserId) })
  if (!initiator) return NextResponse.json({ error: "Support session's initiating user no longer exists" }, { status: 410 })

  const result = await withTenantContext({ orgId: session.targetOrgId, userId: session.targetUserId }, async (tx) => {
    const targetUser = await tx.query.users.findFirst({ where: eq(users.id, session.targetUserId) })
    const targetOrg = await tx.query.organisations.findFirst({ where: eq(organisations.id, session.targetOrgId) })

    await logActivity({
      tx,
      orgId: session.targetOrgId,
      dbUser: initiator,
      action: "support_session.whoami_target_read",
      entityType: "support_session",
      entityId: session.id,
      request,
      supportSession: { id: session.id, actingOnBehalfOfUserId: session.targetUserId },
    })

    return { targetUser, targetOrg }
  })

  return NextResponse.json({
    supportSessionId: session.id,
    initiatedByName: session.initiatedByName,
    expiresAt: session.expiresAt.toISOString(),
    targetOrg: result.targetOrg ? { id: result.targetOrg.id, name: result.targetOrg.name } : null,
    targetUser: result.targetUser ? { id: result.targetUser.id, name: result.targetUser.name, email: result.targetUser.email } : null,
  })
}
