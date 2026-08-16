import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled } from "@/lib/services/pms-enablement-service"
import { compareBaseline, ServiceError } from "@/lib/services/schedule-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    await requirePmsEnabled(ctx.orgId)
    const { id } = await params
    const result = await compareBaseline({ orgId: ctx.orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("pms schedule baseline compare error:", error)
    return NextResponse.json({ error: "Failed to compare baseline" }, { status: 500 })
  }
}
