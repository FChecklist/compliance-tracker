// Real-screen conversion (2026-08-30): first route wired to
// erp-vendor-master-service.ts's sanction-screening log -- same "built with
// zero consumers since Wave 80" gap as bank-accounts/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSanctionChecks, recordSanctionCheck, ServiceError } from "@/lib/services/erp-vendor-master-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const checks = await listSanctionChecks({ orgId: ctx.orgId }, id)
    return NextResponse.json({ checks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor sanction-checks list error:", error)
    return NextResponse.json({ error: "Failed to fetch sanction checks" }, { status: 500 })
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
    const check = await recordSanctionCheck({ orgId: ctx.orgId, userId: actorId }, id, body)
    return NextResponse.json(check, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor sanction-check record error:", error)
    return NextResponse.json({ error: "Failed to record sanction check" }, { status: 500 })
  }
}
