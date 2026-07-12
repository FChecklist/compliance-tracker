import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPendingExecutiveEscalations } from "@/lib/activity-log-service"

// tree4-unified/50-completion-plan Priority 2 item 3, D15/U-D15.B1.S4 "L4
// Executive Audit Review". veridian_admin-gated, same posture as
// /api/ai/team/re-audit -- platform-internal governance, not a customer
// workflow. Lists activity_log rows classified L4-escalation-worthy
// (audit-cadence.ts's classifyAuditCadence(), riskLevel 'high'/'critical')
// that have reached a terminal stage and have not yet been acknowledged at
// an Executive Audit Review -- the real query surface the source doc's
// "Claude reviews... every 3 hours" requires, distinct from a fabricated
// automated report that pretends a review already happened.
export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Executive review queue is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const pending = await listPendingExecutiveEscalations(orgId)
  return NextResponse.json({ pending })
}
