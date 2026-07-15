// Priority 17 Wave 1: thin alias over knowledge-base-service.ts's
// getKbPageBySlug(). No gate -- see ../route.ts header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getKbPageBySlug, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const slug = request.nextUrl.searchParams.get("slug")
  if (!slug) return NextResponse.json({ error: "slug query param is required" }, { status: 400 })

  try {
    const page = await getKbPageBySlug({ orgId: ctx.orgId }, slug)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base get error:", error)
    return NextResponse.json({ error: "Failed to fetch knowledge base page" }, { status: 500 })
  }
}
