// Priority 15 (PROJEXA Invoicing module): thin ALIASING route over
// erp-invoicing-service.ts's arAgingReport -- standard 0-30/31-60/61-90/90+
// day AR aging buckets over every non-fully-paid sales invoice.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { arAgingReport, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await arAgingReport({ orgId: ctx.orgId }, asOfDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ar-aging error:", error)
    return NextResponse.json({ error: "Failed to generate AR aging report" }, { status: 500 })
  }
}
