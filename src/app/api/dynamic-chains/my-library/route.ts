import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getUserChainLibrary } from "@/lib/services/chain-usage-ranking"

// tree4-unified U-D5.B2.S4 ("Two-tier library: Global Library + per-user
// Library, auto-generated from ... History/Behaviour"). The Global Library
// itself is GET /api/dynamic-chains (every approved chain, searchable) --
// this route is specifically the per-user tier: the subset this user has
// actually used before, ranked by recency-weighted frequency. See
// chain-usage-ranking.ts's own header for exactly which of the requirement's
// named personalization inputs (History/Behaviour) this covers and which
// (Role/Department/Projects/Permissions/Teams/Location/Organization) it
// honestly does not.
export async function GET(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ chains: [] })

  try {
    const daysParam = request.nextUrl.searchParams.get("days")
    const days = daysParam ? Math.max(1, parseInt(daysParam, 10) || 90) : 90
    const chains = await getUserChainLibrary(orgId, dbUser.id, days)
    return NextResponse.json({ chains })
  } catch (error) {
    console.error("Personal chain library error:", error)
    return NextResponse.json({ error: "Failed to build personal chain library" }, { status: 500 })
  }
}
