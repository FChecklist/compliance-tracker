import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getTask, updateTask, ServiceError } from "@/lib/services/task-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await getTask({ orgId: ctx.orgId, userId: ctx.dbUser?.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Task detail error:", error)
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // Original route had no extra role gate beyond authentication (any org
  // member could update any task, per RLS) -- 'viewer' as the minimum
  // preserves that for sessions, while still requiring write scope for
  // an API-key caller (a bare read-scoped key shouldn't be able to mutate).
  const roleErr = requireRoleOrScope(ctx, "viewer", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateTask(
      { orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, request },
      id, body
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Task update error:", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }
}
