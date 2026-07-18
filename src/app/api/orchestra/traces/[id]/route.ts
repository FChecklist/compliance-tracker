import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrchestraTraceDetail } from "@/lib/services/orchestra-trace-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const trace = await getOrchestraTraceDetail({ orgId }, id)
    if (!trace) return NextResponse.json({ error: "Trace not found" }, { status: 404 })
    return NextResponse.json(trace)
  } catch (error) {
    console.error("Orchestra trace detail fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch orchestra trace" }, { status: 500 })
  }
}
