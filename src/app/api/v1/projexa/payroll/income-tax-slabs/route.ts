// Priority 15 (PROJEXA HR & Payroll, full-depth pass): TDS slab/rate master
// data (old vs. new regime = two separate records, not a flag).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listIncomeTaxSlabs, createIncomeTaxSlab, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ slabs: [] })

  try {
    const slabs = await listIncomeTaxSlabs({ orgId: ctx.orgId })
    return NextResponse.json({ slabs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa income tax slabs list error:", error)
    return NextResponse.json({ error: "Failed to fetch income tax slabs" }, { status: 500 })
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
    const slab = await createIncomeTaxSlab({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(slab, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa income tax slab create error:", error)
    return NextResponse.json({ error: "Failed to create income tax slab" }, { status: 500 })
  }
}
