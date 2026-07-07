import { NextRequest, NextResponse } from "next/server"
import { resolvePartnerByToken, getPartnerDashboard, ServiceError } from "@/lib/services/sales-engine-service"

// Wave 109 (Sales Engine): public, token-gated partner dashboard data --
// no session, mirroring /api/vendor-portal/[token]'s exact pattern.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const partner = await resolvePartnerByToken(token)
    const dashboard = await getPartnerDashboard(partner.id)
    return NextResponse.json({
      partner: { name: partner.name, partnerType: partner.partnerType, status: partner.status },
      ...dashboard,
    })
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Partner dashboard fetch failed:", error)
    return NextResponse.json({ error: "This partner dashboard link is invalid or has expired" }, { status: 404 })
  }
}
