import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { compareQuotationsForRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ quotations: [] })

  try {
    const { id } = await params
    const quotations = await compareQuotationsForRfq({ orgId }, id)
    return NextResponse.json({ quotations })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQ quotation comparison error:", error)
    return NextResponse.json({ error: "Failed to compare quotations" }, { status: 500 })
  }
}
