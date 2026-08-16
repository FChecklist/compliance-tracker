import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { searchChains } from "@/lib/services/dynamic-chain-directory-service"

// tree4-unified U-D6.B2.S1 ("Directory must support intelligent search/
// recommendation, missing-chain detection, version control"). Wave 171
// (PR #167) built searchChains()/detectMissingChain()/createChainVersion()/
// getChainVersionHistory() in dynamic-chain-directory-service.ts, but a
// direct grep across every route and component before this wave found ZERO
// real callers of any of them -- a real, working mechanism with no way to
// reach it, the same "built but unreachable" gap this session's own
// subagent/qa-gate dispatch already found and closed once before
// (handover-protocol.ts). This route (search/recommendation) plus
// [id]/versions (version control) are what make the Directory's search and
// version-control capabilities real and reachable, not just present in the
// codebase.
//
// GET /api/dynamic-chains?q=<text> -- keyword search across the org's
// approved chains (modePill/pathLabels/description). Omitting q returns an
// empty result rather than the whole Global Library (see the dynamicChains
// documentation on GAP-07 for why an unbounded full-table list isn't built
// here) -- the Global Library itself is out of this route's narrow scope;
// searchChains() already exists and needed a caller, this doesn't invent a
// second listing mechanism next to it.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ results: [] })

  try {
    const q = request.nextUrl.searchParams.get("q") ?? ""
    const limitParam = request.nextUrl.searchParams.get("limit")
    const limit = limitParam ? Math.min(50, Math.max(1, parseInt(limitParam, 10) || 10)) : 10
    const results = await searchChains(orgId, q, limit)
    return NextResponse.json({ results })
  } catch (error) {
    console.error("Dynamic chain search error:", error)
    return NextResponse.json({ error: "Failed to search dynamic chains" }, { status: 500 })
  }
}
