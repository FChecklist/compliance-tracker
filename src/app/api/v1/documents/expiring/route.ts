import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listExpiringDocuments, ServiceError } from "@/lib/services/document-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ documents: [] })

  try {
    const { searchParams } = request.nextUrl
    const withinDaysRaw = searchParams.get("withinDays")
    const withinDays = withinDaysRaw ? Number(withinDaysRaw) : 30
    const category = searchParams.get("category") ?? undefined

    const docs = await listExpiringDocuments({ orgId: ctx.orgId }, withinDays, category)
    return NextResponse.json({ documents: docs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 expiring documents list error:", error)
    return NextResponse.json({ error: "Failed to fetch expiring documents" }, { status: 500 })
  }
}
