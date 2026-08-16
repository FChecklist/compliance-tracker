import { NextRequest, NextResponse } from "next/server"
import { submitAuctionBid, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ token: string; auctionId: string }> }

// Public route (no auth) -- submitAuctionBid() enforces the token, the
// RFQ-invitation check, and the must-undercut-current-lowest rule.
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { token, auctionId } = await params
    const body = await request.json()
    const bid = await submitAuctionBid(token, auctionId, Number(body.bidAmount))
    return NextResponse.json(bid, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor portal bid submission error:", error)
    return NextResponse.json({ error: "Failed to submit bid" }, { status: 500 })
  }
}
