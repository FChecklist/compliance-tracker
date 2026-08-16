import { NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { getVisitorFunnelStats } from "@/lib/services/visitor-intelligence-service"

// Wave 113: Sales HQ read side of visitor intelligence — the funnel the
// VERIDIAN SALES AI panel renders. veridian_admin only, same bar as the
// rest of /api/sales-hq.
export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!hasRole(dbUser, "veridian_admin")) {
    return NextResponse.json({ error: "This action requires veridian_admin role" }, { status: 403 })
  }

  try {
    const stats = await getVisitorFunnelStats(30)
    return NextResponse.json(stats)
  } catch (error) {
    console.error("Visitor funnel fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch visitor funnel" }, { status: 500 })
  }
}
