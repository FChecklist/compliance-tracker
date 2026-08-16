import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { acknowledgeExecutiveEscalation } from "@/lib/activity-log-service"

// POST: acknowledges one pending L4 escalation (see ../route.ts's GET for
// the list). notes is required -- the permanent record of the review
// decision (reassign/escalate/pause/approve/investigate, the source doc's
// own named L4 actions), not a rubber-stamp acknowledgement.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Acknowledging an executive escalation is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const { id } = await params
  const body = await request.json()
  const { notes } = body as { notes?: string }
  if (!notes || notes.trim().length < 10) {
    return NextResponse.json({ error: "A real review decision (at least 10 characters) is required -- this becomes the permanent record of the Executive Audit Review outcome, not a rubber stamp." }, { status: 400 })
  }

  const result = await acknowledgeExecutiveEscalation({ orgId, activityLogId: id, reviewedBy: dbUser.id, notes })
  if (!result.acknowledged) {
    const messages: Record<typeof result.reason, string> = {
      not_found: "No activity_log row found with that id in this organisation.",
      not_pending: "This row is not currently awaiting Executive Audit Review (either already acknowledged, not yet terminal, or not high/critical risk).",
    }
    return NextResponse.json({ status: "rejected", reason: result.reason, message: messages[result.reason] }, { status: 409 })
  }

  return NextResponse.json({ status: "acknowledged" })
}
