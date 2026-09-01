// Real-screen conversion (2026-08-30): first route wired to
// erp-vendor-master-service.ts's self-service portal links -- same "built
// with zero consumers since Wave 80" gap as bank-accounts/route.ts.
// Revoke lives at ./[linkId]/route.ts, matching veri-meetings/share-links'
// list+create-here / revoke-in-[linkId] split from earlier this session.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPortalLinks, createPortalLink, ServiceError } from "@/lib/services/erp-vendor-master-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const links = await listPortalLinks({ orgId: ctx.orgId }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor portal-links list error:", error)
    return NextResponse.json({ error: "Failed to fetch portal links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const link = await createPortalLink({ orgId: ctx.orgId, userId: actorId }, id, body?.expiresInHours)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor portal-link create error:", error)
    return NextResponse.json({ error: "Failed to create portal link" }, { status: 500 })
  }
}
