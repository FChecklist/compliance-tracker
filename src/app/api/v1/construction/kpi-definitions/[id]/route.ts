// Real-screen conversion (2026-08-30): single-definition GET for the KPI
// Object Page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getKpiDefinition, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const definition = await getKpiDefinition({ orgId: ctx.orgId }, id)
    return NextResponse.json(definition)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI definition get error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI definition" }, { status: 500 })
  }
}
