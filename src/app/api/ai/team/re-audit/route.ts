import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { flagForReAudit, listReAuditFlagged } from "@/lib/activity-log-service"

// tree4-unified/50-completion-plan area 9 "Auditing", U-D15.B3.S1 ("no task
// is EVER permanently complete"). veridian_admin-gated, same posture as
// /api/ai/team/review -- this is platform-internal governance, not a
// customer workflow. The one real, reachable trigger this dispatch wires
// (see activity-log-service.ts's flagForReAudit header for why this is the
// flag + query surface, not a fabricated automatic detector): an admin
// explicitly re-opening a previously-closed dispatch because new evidence,
// a changed requirement, or a production incident calls the original
// approval into question.
export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Re-audit list is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const flagged = await listReAuditFlagged(orgId)
  return NextResponse.json({ flagged })
}

export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Flagging for re-audit is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const body = await request.json()
  const { activityLogId, reason } = body as { activityLogId?: string; reason?: string }

  if (!activityLogId) return NextResponse.json({ error: "activityLogId is required" }, { status: 400 })
  if (!reason || reason.trim().length < 10) {
    return NextResponse.json({ error: "A real reason (at least 10 characters) is required -- this becomes the permanent record of why a closed dispatch was re-opened, not a rubber stamp." }, { status: 400 })
  }

  const result = await flagForReAudit({ orgId, activityLogId, reason, requestedBy: dbUser.id })
  if (!result.flagged) {
    const messages: Record<typeof result.reason, string> = {
      not_found: "No activity_log row found with that id in this organisation.",
      not_terminal: "This dispatch has not reached a terminal lifecycle stage yet -- only a completed, failed, or closed dispatch can be flagged for re-audit.",
    }
    return NextResponse.json({ status: "rejected", reason: result.reason, message: messages[result.reason] }, { status: 409 })
  }

  return NextResponse.json({ status: "flagged" })
}
