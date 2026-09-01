import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { findCandidateOutageWindows } from "@/lib/services/provider-outage-service"

// Auto-detected candidate outage windows, reconstructed from clustered
// platform.dispatch_outcomes failures -- never auto-inserted as a
// confirmed incident, only surfaced for an admin to review and promote via
// POST /api/ai/team/provider-outages (source='auto_detected'). See
// provider-outage-service.ts's detectFailureClusters() for the clustering
// rule. veridian_admin-gated, same posture as the rest of this module.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Candidate outage windows are veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(90, Number(sinceDaysParam) || 14)) : undefined

  try {
    const candidates = await findCandidateOutageWindows({ sinceDays })
    return NextResponse.json({ candidates })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to detect candidate outage windows"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
