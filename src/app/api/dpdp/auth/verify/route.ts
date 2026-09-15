// Public, token-in-URL, no session required to reach it -- this is the
// magic link itself. Consumes the token, sets the session cookie, and
// redirects into the app (or to org-creation if the identity has none yet).
import { NextRequest, NextResponse } from "next/server"
import { verifyDpdpMagicLink, ServiceError } from "@/lib/services/dpdp-auth-service"
import { setDpdpSessionCookie } from "@/lib/services/dpdp-session"

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  if (!token) return NextResponse.redirect(new URL("/dpdp/login?error=missing_token", request.url))

  try {
    const result = await verifyDpdpMagicLink(token)
    await setDpdpSessionCookie(result.sessionToken, result.expiresAt)
    // Real identity, zero orgs yet -- straight to "make an organisation".
    return NextResponse.redirect(new URL(result.orgId ? "/dpdp/home" : "/dpdp/onboarding", request.url))
  } catch (error) {
    const message = error instanceof ServiceError ? error.message : "Could not sign you in"
    return NextResponse.redirect(new URL(`/dpdp/login?error=${encodeURIComponent(message)}`, request.url))
  }
}
