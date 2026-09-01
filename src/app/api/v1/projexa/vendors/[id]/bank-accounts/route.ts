// Real-screen conversion (2026-08-30): first route ever wired to
// erp-vendor-master-service.ts's banking functions (Wave 80 built the
// service layer with zero consumers -- confirmed via a repo-wide search
// before writing this file). No FK constraint on createdById (see that
// table's schema comment -- plain nullable text, no .references()), so the
// dbUser-or-apiKey actor union used everywhere else in this session's
// identity-bridge fixes is safe here without a widened ctx type -- just
// resolve the id string and pass it through.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBankAccounts, addBankAccount, ServiceError } from "@/lib/services/erp-vendor-master-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const accounts = await listBankAccounts({ orgId: ctx.orgId }, id)
    return NextResponse.json({ bankAccounts: accounts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor bank-accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 })
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
    const account = await addBankAccount({ orgId: ctx.orgId, userId: actorId }, id, body)
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor bank-account add error:", error)
    return NextResponse.json({ error: "Failed to add bank account" }, { status: 500 })
  }
}
