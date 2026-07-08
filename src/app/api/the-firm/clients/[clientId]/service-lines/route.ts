import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setServiceLineForClient, listServiceLinesForClient, ServiceError, type FirmServiceLine } from "@/lib/services/firm-client-service-line-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const serviceLines = await listServiceLinesForClient({ orgId }, clientId)
    return NextResponse.json({ serviceLines })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List service lines error:", error)
    return NextResponse.json({ error: "Failed to list service lines" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json()
    if (!body.serviceLine) return NextResponse.json({ error: "serviceLine is required" }, { status: 400 })

    const result = await setServiceLineForClient({ orgId }, clientId, body.serviceLine as FirmServiceLine, {
      isEnabled: body.isEnabled, leadStaffUserId: body.leadStaffUserId, notes: body.notes,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Set service line error:", error)
    return NextResponse.json({ error: "Failed to set service line" }, { status: 500 })
  }
}
