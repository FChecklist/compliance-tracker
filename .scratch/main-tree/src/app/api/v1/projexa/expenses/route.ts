import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listExpenseEntries, createExpenseEntry, ServiceError } from "@/lib/services/construction-expense-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ expenses: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const entries = await listExpenseEntries({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ expenses: entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa expenses list error:", error)
    return NextResponse.json({ error: "Failed to fetch expenses" }, { status: 500 })
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
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await createExpenseEntry({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa expense create error:", error)
    return NextResponse.json({ error: "Failed to create expense entry" }, { status: 500 })
  }
}
