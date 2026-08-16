import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import type { UserRole } from "@/lib/supabase/auth-guard"
import { resolveAssetQuery } from "@/lib/services/asset-routing-engine"

// Priority 3 (Universal Metadata Registry, agent 2 "routing"): the real,
// live caller of resolveAssetQuery() -- this session's own tracker already
// flagged two prior "built but zero callers" cases, so this route exists
// specifically to prove the Routing Engine isn't dead code. `requireAuth()`
// gate matches this codebase's own convention (AGENTS.md: "All API routes
// MUST call requireAuth()"), same shape as /api/search and
// /api/documents/search.
export async function GET(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ query: "", results: [], classification: { assetType: null, module: null, source: "none" } })

  const query = request.nextUrl.searchParams.get("q") ?? ""
  if (!query.trim()) {
    return NextResponse.json({ query: "", results: [], classification: { assetType: null, module: null, source: "none" } })
  }

  try {
    const result = await resolveAssetQuery(query, { orgId, userId: dbUser.id, userRole: dbUser.role as UserRole })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Asset search API error:", error)
    return NextResponse.json({ error: "Asset search failed" }, { status: 500 })
  }
}
