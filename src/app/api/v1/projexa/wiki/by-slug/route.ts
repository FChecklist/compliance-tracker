// Priority 17 Wave 1: thin alias over pms-wiki-service.ts's
// getWikiPageBySlug(). No requirePmsEnabled() gate -- see ../route.ts
// header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getWikiPageBySlug, ServiceError } from "@/lib/services/pms-wiki-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  const slug = request.nextUrl.searchParams.get("slug")
  if (!projectId || !slug) return NextResponse.json({ error: "projectId and slug query params are required" }, { status: 400 })

  try {
    const page = await getWikiPageBySlug({ orgId: ctx.orgId }, projectId, slug)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa wiki get error:", error)
    return NextResponse.json({ error: "Failed to fetch wiki page" }, { status: 500 })
  }
}
