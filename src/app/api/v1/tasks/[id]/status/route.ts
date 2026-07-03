import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getTaskStatus, ServiceError } from "@/lib/services/task-service"

type RouteContext = { params: Promise<{ id: string }> }

// Wave 11: a lightweight status-only read, distinct from the full
// GET /api/v1/tasks/{id} (which also returns the execution plan + chat) --
// this is what the new MCP get_task_status tool calls via internal fetch(),
// since a customer's AI asking "is this task done" shouldn't have to pull
// the full detail every time.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await getTaskStatus({ orgId: ctx.orgId, userId: ctx.dbUser?.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 task status error:", error)
    return NextResponse.json({ error: "Failed to fetch task status" }, { status: 500 })
  }
}
