import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { listChecklistItems, addChecklistItem, ServiceError } from "@/lib/services/erp-financial-report-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })

  try {
    const { id } = await params
    const items = await listChecklistItems({ orgId }, id)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period checklist list error:", error)
    return NextResponse.json({ error: "Failed to fetch checklist" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: adding period-close checklist items is a managerial task
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_year.checklist_add")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const item = await addChecklistItem({ orgId, userId: dbUser.id }, id, { title: body.title, taskType: body.taskType, assignedToId: body.assignedToId })
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period checklist item create error:", error)
    return NextResponse.json({ error: "Failed to add checklist item" }, { status: 500 })
  }
}
