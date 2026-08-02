// Priority 15 (PROJEXA HR & Payroll, full-depth pass): assigns (or clears)
// an employee's income tax slab -- the opt-in switch for payroll TDS
// auto-computation (erp-payroll-service.ts's assignIncomeTaxSlab).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { assignIncomeTaxSlab, ServiceError } from "@/lib/services/erp-payroll-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await assignIncomeTaxSlab({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id, body.slabId || undefined)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa assign income tax slab error:", error)
    return NextResponse.json({ error: "Failed to assign income tax slab" }, { status: 500 })
  }
}
