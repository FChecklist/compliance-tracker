// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// compareQuotationsForRfq -- side-by-side comparison of every quotation
// received against this RFQ, ranked by total (and weighted score, if the
// org has configured scoring criteria). Backs the "record a quotation
// response" stage of the Procurement page's drill-in view.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { compareQuotationsForRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const comparison = await compareQuotationsForRfq({ orgId: ctx.orgId }, id)
    return NextResponse.json({ comparison })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement rfq comparison error:", error)
    return NextResponse.json({ error: "Failed to compare RFQ quotations" }, { status: 500 })
  }
}
