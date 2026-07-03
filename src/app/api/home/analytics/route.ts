import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAnalyticsRollup } from "@/lib/services/home-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ scope: "individual", peopleCount: null, complianceByStatus: {}, taskByStatus: {} })

  try {
    // Scope is derived server-side from the caller's own real role -- never
    // trust a client-supplied scope parameter for something access-shaped.
    const result = await getAnalyticsRollup({ orgId, userId: dbUser.id, role: dbUser.role })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Home analytics error:", error)
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 })
  }
}
