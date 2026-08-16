import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getKbPageBySlug, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const slug = request.nextUrl.searchParams.get("slug")
  if (!slug) return NextResponse.json({ error: "slug query param is required" }, { status: 400 })

  try {
    const page = await getKbPageBySlug({ orgId }, slug)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Knowledge base get error:", error)
    return NextResponse.json({ error: "Failed to fetch knowledge base page" }, { status: 500 })
  }
}
