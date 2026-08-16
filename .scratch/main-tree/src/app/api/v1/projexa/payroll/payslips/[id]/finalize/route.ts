// Priority 15 (PROJEXA HR & Payroll, Wave 1): finalizes a draft payslip
// (locks it -- no further TDS edits after this).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { finalizePayslip, ServiceError } from "@/lib/services/erp-payroll-service"

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
    const updated = await finalizePayslip({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payslip finalize error:", error)
    return NextResponse.json({ error: "Failed to finalize payslip" }, { status: 500 })
  }
}
