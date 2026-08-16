import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateAutomationRule, deleteAutomationRule, ServiceError } from "@/lib/services/automation-rule-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateAutomationRule({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Automation rule update error:", error)
    return NextResponse.json({ error: "Failed to update automation rule" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    await deleteAutomationRule({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Automation rule delete error:", error)
    return NextResponse.json({ error: "Failed to delete automation rule" }, { status: 500 })
  }
}
