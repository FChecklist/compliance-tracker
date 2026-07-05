import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { validateSsoAssertionAndGetUser, ServiceError } from "@/lib/services/sso-service"

// The SAML Assertion Consumer Service -- public by definition (the IdP
// POSTs the assertion here after the user authenticates at the IdP).
// Session establishment reuses the EXISTING Supabase magic-link +
// /auth/callback code-exchange flow already in production: mint an admin
// magic link for the matched user's email, then redirect the browser
// through Supabase's own hosted verify endpoint, which itself redirects
// back to /auth/callback?code=... to complete the session. No second
// session mechanism invented for this.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { origin } = new URL(request.url)
  const callbackUrl = `${origin}/api/auth/sso/${orgSlug}/acs`

  try {
    const formData = await request.formData()
    const samlResponse = formData.get("SAMLResponse")
    if (typeof samlResponse !== "string") {
      return NextResponse.redirect(new URL("/login?error=sso_missing_response", request.url))
    }

    const { email } = await validateSsoAssertionAndGetUser(orgSlug, samlResponse, callbackUrl)

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origin}/auth/callback` },
    })
    if (error || !data.properties?.action_link) {
      console.error("SSO magic link generation error:", error)
      return NextResponse.redirect(new URL("/login?error=sso_session_failed", request.url))
    }

    return NextResponse.redirect(data.properties.action_link)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.redirect(new URL(`/login?error=sso_${error.status}`, request.url))
    console.error("SSO ACS error:", error)
    return NextResponse.redirect(new URL("/login?error=sso_failed", request.url))
  }
}
