// Priority 17 Wave 1: thin alias over pms-wiki-service.ts's
// listWikiPages()/createWikiPage(). No requirePmsEnabled() gate here --
// same reasoning as ../schedule/sprints/route.ts and the existing
// ../meetings/route.ts: pms_wiki_pages is PROJEXA's generic per-project
// documentation substrate here, not the separately-purchased VERIDIAN AI
// PMS product's own surface (that's what /api/pms/wiki/* gates).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listWikiPages, createWikiPage, ServiceError } from "@/lib/services/pms-wiki-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ pages: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const pages = await listWikiPages({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa wiki list error:", error)
    return NextResponse.json({ error: "Failed to fetch wiki pages" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // createWikiPage() attributes authorship via updatedById -- matches the
  // same "requires a real user session" convention already used on every
  // other actor-attribution write in this wave (timesheets, and the
  // native /api/pms/wiki route this aliases).
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const result = await createWikiPage({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body.projectId, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa wiki create error:", error)
    return NextResponse.json({ error: "Failed to create wiki page" }, { status: 500 })
  }
}
