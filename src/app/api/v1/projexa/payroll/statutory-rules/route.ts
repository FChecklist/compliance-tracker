// Priority 15 (PROJEXA HR & Payroll, full-depth pass): admin-editable
// PF/ESI/Professional-Tax rate master data (never hardcoded -- see
// erp-payroll-service.ts's own header for why).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listStatutoryRules, createStatutoryRule, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ rules: [] })

  try {
    const rules = await listStatutoryRules({ orgId: ctx.orgId })
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa statutory rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch statutory rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const rule = await createStatutoryRule({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa statutory rule create error:", error)
    return NextResponse.json({ error: "Failed to create statutory rule" }, { status: 500 })
  }
}
