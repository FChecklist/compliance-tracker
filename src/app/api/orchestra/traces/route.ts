import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listOrchestraTraces } from "@/lib/services/orchestra-trace-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { searchParams } = request.nextUrl
  try {
    const result = await listOrchestraTraces(
      { orgId },
      {
        layerKey: searchParams.get("layerKey") || undefined,
        status: searchParams.get("status") || undefined,
        model: searchParams.get("model") || undefined,
        startDate: searchParams.get("startDate") || undefined,
        endDate: searchParams.get("endDate") || undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
        limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    console.error("Orchestra traces fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch orchestra traces" }, { status: 500 })
  }
}
