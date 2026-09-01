// Priority 17 Wave 1: thin alias over knowledge-base-service.ts's
// updateKbPage(). No gate -- see ../route.ts header.
//
// Real-screen conversion (2026-08-30): the hard `if (!ctx.dbUser) return
// ... "requires a real user session, not an API key"` block below is gone
// -- updateKbPage() itself now accepts either actor (see that function's
// own comment for why this was previously unsafe: an unconditional
// `updatedById: ctx.userId` would have written an api_keys.id into a real
// FK to users.id). PROJEXA's Bearer-key caller can now actually save an
// edited page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getKbPage, updateKbPage, ServiceError } from "@/lib/services/knowledge-base-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const page = await getKbPage({ orgId: ctx.orgId }, id)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base get error:", error)
    return NextResponse.json({ error: "Failed to fetch knowledge base page" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const result = await updateKbPage(actorCtx, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base update error:", error)
    return NextResponse.json({ error: "Failed to update knowledge base page" }, { status: 500 })
  }
}
