import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { getWikiPageBySlug } from "@/lib/services/pms-wiki-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  const slug = request.nextUrl.searchParams.get("slug")
  if (!projectId || !slug) return NextResponse.json({ error: "projectId and slug query params are required" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const page = await getWikiPageBySlug({ orgId }, projectId, slug)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS wiki get error:", error)
    return NextResponse.json({ error: "Failed to fetch wiki page" }, { status: 500 })
  }
}
