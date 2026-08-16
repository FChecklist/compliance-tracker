import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAuctionBids, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ bids: [] })

  try {
    const { id } = await params
    const bids = await listAuctionBids({ orgId }, id)
    return NextResponse.json({ bids })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Auction bids list error:", error)
    return NextResponse.json({ error: "Failed to fetch bids" }, { status: 500 })
  }
}
