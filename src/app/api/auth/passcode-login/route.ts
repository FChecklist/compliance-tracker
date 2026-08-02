import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { verifyPasscodeLogin } from "@/lib/passcode-login-service"

// Priority 14 Wave 2 (GAP-AUTH-REBUILD): public, pre-auth route -- a
// returning user who already set a passcode in Settings signs in with
// email+passcode instead of waiting for a magic-link email. Session
// establishment reuses the EXISTING admin-magic-link mechanism already in
// production for SSO (src/app/api/auth/sso/[orgSlug]/acs/route.ts): mint an
// admin magic link for the verified user's email, then return its
// action_link for the client to navigate to -- Supabase's own hosted verify
// endpoint redirects back to /auth/callback?code=..., which completes the
// PKCE exchange and sets the session cookie exactly like a real clicked
// magic-link email would. No second session mechanism invented here, and
// the passcode itself never appears in any URL (submitted in this POST's
// JSON body only) -- only Supabase's own single-use magic-link token ends
// up in a URL, same as the existing SSO flow.
//
// See src/lib/passcode-login-service.ts's header comment for the full
// security-property writeup (bcrypt hashing, dual email+IP rate limiting,
// generic failure responses, no recovery capability). This route adds no
// security logic of its own beyond extracting the caller's IP and shaping
// the HTTP response -- verifyPasscodeLogin() owns every real decision.
export async function POST(request: Request) {
  const { origin } = new URL(request.url)

  let body: { email?: unknown; passcode?: unknown; redirectTo?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const passcode = typeof body.passcode === "string" ? body.passcode.trim() : ""
  const redirectTo = typeof body.redirectTo === "string" && body.redirectTo.startsWith("/") ? body.redirectTo : "/home"

  if (!email || !passcode) {
    return NextResponse.json({ error: "Email and passcode are required" }, { status: 400 })
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown"

  const result = await verifyPasscodeLogin(email, passcode, ipAddress)

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later, or sign in with a magic link instead." },
        { status: 429, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined }
      )
    }
    // Deliberately the same generic message regardless of WHY it failed
    // (no account, no passcode set, wrong passcode) -- see
    // verifyPasscodeLogin's own header comment for why.
    return NextResponse.json({ error: "Invalid email or passcode." }, { status: 401 })
  }

  try {
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: result.user.email,
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
    })
    if (error || !data.properties?.action_link) {
      console.error("Passcode-login magic link generation error:", error)
      return NextResponse.json({ error: "Could not complete sign-in. Please try again or use a magic link." }, { status: 500 })
    }

    return NextResponse.json({ actionLink: data.properties.action_link })
  } catch (err) {
    console.error("Passcode-login session establishment error:", err)
    return NextResponse.json({ error: "Could not complete sign-in. Please try again or use a magic link." }, { status: 500 })
  }
}
