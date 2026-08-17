// FI-AR-004 (Dunning List): thin ALIASING route over erp-invoicing-
// service.ts's dunningList -- every overdue customer invoice grouped by
// aging bucket, with each row's real dunningLevel/lastDunningSentAt plus a
// suggestedDunningLevel. Mirrors ar-aging/route.ts's shape exactly.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { dunningList, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await dunningList({ orgId: ctx.orgId }, asOfDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dunning-list error:", error)
    return NextResponse.json({ error: "Failed to generate dunning list" }, { status: 500 })
  }
}
