// R67 lane I (WS-I item I-05, R-177): the org's editable BOQ category list --
// what the Category select on a BOQ line offers, and what PROJEXA's Settings
// screen edits. Same auth/role pattern as the sibling v1/construction/boq
// routes (requireAuthOrApiKey + requireRoleOrScope for writes).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBoqCategories, createBoqCategory, ServiceError } from "@/lib/services/construction-boq-category-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    // Retired categories are hidden by default -- a picker must not offer one
    // -- but Settings passes includeInactive=1 so an admin can see (and
    // reactivate) what was retired.
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1"
    const categories = await listBoqCategories({ orgId: ctx.orgId }, { includeInactive })
    return NextResponse.json({ categories })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ category list error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQ categories" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const created = await createBoqCategory({ orgId: ctx.orgId }, body?.name)
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ category create error:", error)
    return NextResponse.json({ error: "Failed to create BOQ category" }, { status: 500 })
  }
}
