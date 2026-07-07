import { NextRequest, NextResponse } from "next/server"
import { resolveReferralLinkAndRecordClick, ServiceError } from "@/lib/services/sales-engine-service"

// Wave 109 (Sales Engine): public referral-link redirect. Not under
// /api/ so the shared URL stays the clean /r/<token> the product spec
// calls for. Deliberately excluded from middleware.ts's
// PROTECTED_APP_ROUTE_PREFIXES, same posture as /vendor-portal/[token].
const PRODUCT_LANDING_PAGES: Record<string, string> = {
  the_firm: "/the-firm",
  forge: "/forge",
  facilities_management: "/veri-fm-cs",
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const signupUrl = new URL("/signup", request.url)

  try {
    const link = await resolveReferralLinkAndRecordClick(token)
    const destinationPath = link.productKey ? PRODUCT_LANDING_PAGES[link.productKey] ?? "/signup" : "/signup"
    const url = new URL(destinationPath, request.url)
    url.searchParams.set("ref", token)
    return NextResponse.redirect(url)
  } catch (error) {
    if (error instanceof ServiceError) {
      // Dead/deactivated link -- fail open to a generic signup, never a dead end.
      return NextResponse.redirect(signupUrl)
    }
    console.error("Referral link redirect failed:", error)
    return NextResponse.redirect(signupUrl)
  }
}
