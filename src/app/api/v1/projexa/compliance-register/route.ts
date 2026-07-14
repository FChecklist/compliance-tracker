// Priority 15 (PROJEXA GRC module, Wave 1): thin ALIASING route -- zero new
// business logic. compliance-service.ts is this codebase's original,
// most-mature module (the whole app started as a compliance platform), so
// this is pure reuse: listComplianceItems/createComplianceItem already
// return/accept everything a construction PM's risk & compliance register
// needs (title, type, status, priority, due date, department, assignee).
// No construction-domain field renaming here (unlike vendors/expenses) --
// "compliance item" is already generic vocabulary that applies directly to
// a construction org's own statutory/regulatory obligations.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listComplianceItems, createComplianceItem, ServiceError, type CreateComplianceInput } from "@/lib/services/compliance-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ register: [], total: 0, page: 1, limit: 20, totalPages: 0 })

  try {
    const sp = request.nextUrl.searchParams
    const result = await listComplianceItems({ orgId: ctx.orgId }, {
      search: sp.get("search") ?? undefined,
      status: sp.get("status") ?? undefined,
      departmentId: sp.get("departmentId") ?? undefined,
      complianceType: sp.get("complianceType") ?? undefined,
      sortBy: sp.get("sortBy") ?? undefined,
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    })
    return NextResponse.json({ register: result.compliance, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa compliance-register list error:", error)
    return NextResponse.json({ error: "Failed to fetch compliance register" }, { status: 500 })
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
    const actor = ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }
    const input: CreateComplianceInput = {
      title: body.title, description: body.description, complianceType: body.complianceType,
      priority: body.priority, dueDate: body.dueDate, departmentId: body.departmentId,
      assignedToId: body.assignedToId, period: body.period, financialYear: body.financialYear,
      acknowledgementNumber: body.acknowledgementNumber, registrationNumber: body.registrationNumber,
      amount: body.amount, recurrenceType: body.recurrenceType, clientId: body.clientId,
    }
    const item = await createComplianceItem({ orgId: ctx.orgId, actor, request }, input)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa compliance-register create error:", error)
    return NextResponse.json({ error: "Failed to create compliance register item" }, { status: 500 })
  }
}
