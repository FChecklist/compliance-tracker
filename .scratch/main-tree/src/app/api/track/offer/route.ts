import { NextRequest, NextResponse } from "next/server"
import { decideExitOffer } from "@/lib/services/visitor-intelligence-service"

// Wave 113: exit-intent offer decision. Public by design (same rationale as
// /api/track). The rules ladder inside decideExitOffer() picks the offer
// from what the platform knows about this visitor (visit count, sections
// reached) and logs offer_shown — the shown/clicked/converted trail is what
// Sales HQ's VERIDIAN SALES AI analyzes.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { visitorId?: string; productKey?: string; sectionsSeen?: string[] }
    if (!body.visitorId) return NextResponse.json({ error: "visitorId required" }, { status: 400 })
    const offer = await decideExitOffer(
      body.visitorId.slice(0, 64),
      body.productKey ?? null,
      Array.isArray(body.sectionsSeen) ? body.sectionsSeen.slice(0, 20).map(String) : []
    )
    return NextResponse.json({ offer })
  } catch (error) {
    console.error("offer decision failed:", error)
    return NextResponse.json({ error: "unavailable" }, { status: 500 })
  }
}
