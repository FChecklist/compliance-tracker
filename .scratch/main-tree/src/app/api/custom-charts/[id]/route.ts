import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateCustomChart, deleteCustomChart, ServiceError } from "@/lib/services/custom-chart-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateCustomChart({ orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Custom chart update error:", error)
    return NextResponse.json({ error: "Failed to update custom chart" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    await deleteCustomChart({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Custom chart delete error:", error)
    return NextResponse.json({ error: "Failed to delete custom chart" }, { status: 500 })
  }
}
