import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { clearReAuditFlag } from "@/lib/activity-log-service"

/** Clears a re-audit flag once the flagged item has actually been re-audited and resolved -- see activity-log-service.ts's clearReAuditFlag. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Clearing a re-audit flag is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const { id } = await params
  const result = await clearReAuditFlag(orgId, id)
  if (!result.cleared) return NextResponse.json({ error: "Activity log row not found" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
