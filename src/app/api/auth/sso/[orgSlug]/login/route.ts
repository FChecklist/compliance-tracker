import { NextResponse } from "next/server"
import { getSsoLoginRedirectUrl, ServiceError } from "@/lib/services/sso-service"

// Public by definition -- this IS the unauthenticated login entry point.
// A visitor navigates here (e.g. from a "Continue with SSO" link on the
// login page) and is redirected to their org's IdP.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params
    const { origin } = new URL(request.url)
    const callbackUrl = `${origin}/api/auth/sso/${orgSlug}/acs`
    const redirectUrl = await getSsoLoginRedirectUrl(orgSlug, callbackUrl)
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.redirect(new URL(`/login?error=sso_${error.status}`, request.url))
    console.error("SSO login redirect error:", error)
    return NextResponse.redirect(new URL("/login?error=sso_failed", request.url))
  }
}
