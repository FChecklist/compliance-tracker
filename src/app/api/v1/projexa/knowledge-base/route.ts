// Priority 17 Wave 1: thin alias over knowledge-base-service.ts's
// listKbPages()/createKbPage(). Org-wide (not project-scoped), and
// deliberately never gated on requirePmsEnabled() -- knowledge-base-
// service.ts's own header states this is a core module with no
// enablement toggle at all, distinct from the per-project pms_wiki_pages
// (../wiki/*), which is a genuinely different concept (org-wide reference
// docs vs. per-project working notes).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listKbPages, createKbPage, ServiceError } from "@/lib/services/knowledge-base-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ pages: [] })

  try {
    const pages = await listKbPages({ orgId: ctx.orgId })
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base list error:", error)
    return NextResponse.json({ error: "Failed to fetch knowledge base pages" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createKbPage({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base create error:", error)
    return NextResponse.json({ error: "Failed to create knowledge base page" }, { status: 500 })
  }
}
