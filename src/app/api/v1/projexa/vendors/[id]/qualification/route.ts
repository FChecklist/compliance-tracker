// Real-screen conversion (2026-08-30): first route wired to
// erp-vendor-master-service.ts's qualification workflow -- same "built with
// zero consumers since Wave 80" gap as bank-accounts/route.ts, same reasoning
// for why the dbUser-or-apiKey actor union needs no ctx-type widening here.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listQualificationReviews, recordQualificationReview, ServiceError } from "@/lib/services/erp-vendor-master-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const reviews = await listQualificationReviews({ orgId: ctx.orgId }, id)
    return NextResponse.json({ reviews })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor qualification list error:", error)
    return NextResponse.json({ error: "Failed to fetch qualification reviews" }, { status: 500 })
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
    const body = await request.json()
    const review = await recordQualificationReview({ orgId: ctx.orgId, userId: actorId }, id, body)
    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor qualification record error:", error)
    return NextResponse.json({ error: "Failed to record qualification review" }, { status: 500 })
  }
}
