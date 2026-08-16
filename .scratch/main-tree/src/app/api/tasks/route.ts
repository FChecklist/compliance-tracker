import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listTasks, createTask, ServiceError } from "@/lib/services/task-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ tasks: [] })

  try {
    const assistantId = request.nextUrl.searchParams.get("assistantId") ?? undefined
    const result = await listTasks({ orgId: ctx.orgId, userId: ctx.dbUser?.id }, { assistantId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tasks list error:", error)
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // Task creation dispatches the real task-execution engine on behalf of a
  // specific person -- requires a real session, not an API key (matches
  // createTask()'s own guard in the service layer).
  if (!ctx.dbUser) return NextResponse.json({ error: "Task creation requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createTask({ orgId: ctx.orgId, actor: { dbUser: ctx.dbUser }, request }, body)
    // Wave 146: high-impact confirmation gate -- nothing was created yet, so
    // this is intentionally NOT a 201. The caller resubmits the same body
    // plus `confirmed: true` to actually create+execute the task.
    if ("needsConfirmation" in result && result.needsConfirmation) {
      return NextResponse.json(result, { status: 200 })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Task create error:", error)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
  }
}
