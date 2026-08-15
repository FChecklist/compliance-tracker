import { NextResponse } from "next/server"
import { hasRole, requireAuth } from "@/lib/supabase/auth-guard"
import { listSupportSessionsForOrg } from "@/lib/services/support-session-service"

// The impersonated org's own admin querying support sessions run against
// THEIR org -- the "visible to the impersonated org" half of the spec.
// Real app_runtime/RLS path (see support-session-service.ts's
// listSupportSessionsForOrg), scoped by target_org_id =
// compliance.current_org_id() -- never returns another org's rows even if
// this handler had a bug, the same guarantee every other tenant table gets.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  if (!hasRole(dbUser, "admin")) {
    return NextResponse.json({ error: "This action requires admin role or higher" }, { status: 403 })
  }

  try {
    const sessions = await listSupportSessionsForOrg(orgId)
    return NextResponse.json({
      items: sessions.map((s) => ({
        id: s.id,
        initiatedByName: s.initiatedByName,
        targetUserName: s.targetUserName,
        reason: s.reason,
        expiresAt: s.expiresAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        endedReason: s.endedReason,
        createdAt: s.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Support sessions on-my-org list error:", error)
    return NextResponse.json({ error: "Failed to fetch support sessions" }, { status: 500 })
  }
}
