import { NextRequest, NextResponse } from "next/server"
import { hasRole, requireAuth } from "@/lib/supabase/auth-guard"
import { endSupportSession, getSupportSessionById } from "@/lib/services/support-session-service"
import { ServiceError } from "@/lib/services/compliance-service"

// Two distinct callers can end a session early, matching "visible to (and
// controllable by) the impersonated org" from the spec:
//   - the veridian_admin who runs support, ending any session
//   - the TARGET org's own admin, ending a session run against their own
//     data (a real kill switch -- the impersonated org is never stuck
//     waiting out the fixed 1-hour window if they want it stopped now)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  try {
    const { id } = await params
    const session = await getSupportSessionById(id)
    if (!session) return NextResponse.json({ error: "Support session not found" }, { status: 404 })

    const isSupportAdmin = hasRole(dbUser, "veridian_admin")
    const isTargetOrgAdmin = dbUser.orgId === session.targetOrgId && hasRole(dbUser, "admin")
    if (!isSupportAdmin && !isTargetOrgAdmin) {
      return NextResponse.json({ error: "Not authorized to end this support session" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const endedReason = typeof body?.endedReason === "string" ? body.endedReason : undefined

    const result = await endSupportSession({ id, endedBy: dbUser, endedReason })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Support session end error:", error)
    return NextResponse.json({ error: "Failed to end support session" }, { status: 500 })
  }
}
