import { NextRequest, NextResponse } from "next/server"
import { recordReferralClick } from "@/lib/services/veri-reward-service"

// Wave 113 (VERI Treasure): public refer-and-earn redirect, mirrors
// /r/[token]/route.ts (Sales Engine) exactly but under its own /vr/ prefix
// so the two referral systems' tokens never collide -- this one is
// org-scoped/RLS-protected end-user reward points, not the platform-owned
// external-partner commission system. Deliberately excluded from
// middleware.ts's PROTECTED_APP_ROUTE_PREFIXES, same posture as /r/[token].
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const signupUrl = new URL("/signup", request.url)

  try {
    const referral = await recordReferralClick(token)
    if (!referral) return NextResponse.redirect(signupUrl) // dead/invalid token -- fail open to signup, never a dead end

    signupUrl.searchParams.set("vref", token)
    return NextResponse.redirect(signupUrl)
  } catch (error) {
    console.error("VERI Treasure referral redirect failed:", error)
    return NextResponse.redirect(signupUrl)
  }
}
