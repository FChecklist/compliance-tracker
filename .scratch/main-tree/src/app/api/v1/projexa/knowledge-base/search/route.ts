// Priority 17 Wave 1: thin alias over knowledge-base-service.ts's
// searchKbPages(). No gate -- see ../route.ts header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { searchKbPages, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ pages: [] })

  try {
    const q = request.nextUrl.searchParams.get("q") ?? ""
    const pages = await searchKbPages({ orgId: ctx.orgId }, q)
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base search error:", error)
    return NextResponse.json({ error: "Failed to search knowledge base" }, { status: 500 })
  }
}
