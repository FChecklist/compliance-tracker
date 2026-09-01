// Real-screen conversion (2026-08-30): single-RFQ GET for the RFQ Object
// Page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const rfq = await getRfq({ orgId: ctx.orgId }, id)
    return NextResponse.json(rfq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa rfq get error:", error)
    return NextResponse.json({ error: "Failed to fetch RFQ" }, { status: 500 })
  }
}
