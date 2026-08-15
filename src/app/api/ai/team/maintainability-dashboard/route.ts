import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getMaintainabilityScorecard } from "@/lib/services/maintainability-dashboard-service"

// VERIDIAN Review Framework gap-closure (2026-07-18), "Maintainability" --
// same veridian_admin-gated, platform-internal-governance posture as its
// sibling /api/ai/team/governance-health (this is a Chief Audit Officer /
// Engineering Assurance Division concern, not a customer-facing feature).
// See maintainability-dashboard-service.ts's header for exactly which real
// signals back this score and which named dimensions are honestly not
// covered.
export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Maintainability dashboard is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const scorecard = await getMaintainabilityScorecard(orgId)
  return NextResponse.json(scorecard)
}
