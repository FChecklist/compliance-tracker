import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { searchKbPages, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ pages: [] })

  try {
    const q = request.nextUrl.searchParams.get("q") ?? ""
    const pages = await searchKbPages({ orgId }, q)
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Knowledge base search error:", error)
    return NextResponse.json({ error: "Failed to search knowledge base" }, { status: 500 })
  }
}
