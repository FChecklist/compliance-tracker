import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { searchAll } from "@/lib/services/search-service"

// Area 14 (Common functionalities) gap-close: the "Standard" (non-AI) tab of
// search-command.tsx previously called /api/compliance?search= directly --
// there was no route that searched more than one entity type without going
// through the embeddings-backed /api/search/semantic path. This is that
// route: cheap, synchronous ILIKE search across compliance items, tasks, and
// clients, grouped by type like the semantic route already does.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ query: "", total: 0, results: { compliance_items: [], tasks: [], clients: [] } })

  try {
    const { searchParams } = request.nextUrl
    const query = searchParams.get("q") ?? searchParams.get("search") ?? ""
    const limit = Number(searchParams.get("limit")) || 8

    const results = await searchAll({ orgId }, query, limit)
    const total = results.compliance_items.length + results.tasks.length + results.clients.length

    return NextResponse.json({ query: query.trim(), total, results })
  } catch (error) {
    console.error("Search API error:", error)
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}
