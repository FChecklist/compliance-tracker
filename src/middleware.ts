import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { PROTECTED_APP_ROUTE_PREFIXES } from "@/lib/protected-routes.generated"

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes: redirect to login if not authenticated.
  //
  // Gap-closure fix, 2026-07-09 (AUDIT_2026-07-09.md, Security Assessment):
  // this used to be a hand-maintained array here, and it drifted out of
  // sync with the real src/app/(app)/ directory listing 4 separate times
  // across this project's history (most recently missing /connectors,
  // /gst-reconciliation, /tds-returns, /the-firm-practice) -- each time a
  // new module shipped a page directory without the array being updated in
  // the same PR. No data actually leaked in any of the 4 incidents (every
  // fetch inside those pages goes through requireAuth()-gated API routes
  // independently), but this defense-in-depth layer was silently absent
  // each time. PROTECTED_APP_ROUTE_PREFIXES is now generated directly from
  // the filesystem (scripts/generate-protected-routes.mjs, run via the
  // predev/prebuild npm scripts) so the next missing route is impossible by
  // construction rather than a bug someone has to notice.
  const isAppRoute = PROTECTED_APP_ROUTE_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirectTo", request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Wave 97 (Comparison CSV 3 gap analysis: IAM003 "MFA Enrollment"): a user
  // who has enrolled a verified TOTP factor has nextLevel='aal2' but a
  // session that hasn't completed the challenge yet is still at
  // currentLevel='aal1' -- Supabase Auth's own documented signal for "MFA
  // is required but not yet satisfied this session." Real gate, not a
  // UI-only nudge: every protected app route is blocked until the
  // /mfa-challenge page raises the session to aal2.
  if (user && isAppRoute && request.nextUrl.pathname !== "/mfa-challenge") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      const url = request.nextUrl.clone()
      url.pathname = "/mfa-challenge"
      url.searchParams.set("redirectTo", request.nextUrl.pathname)
      return NextResponse.redirect(url)
    }
  }

  // If user is logged in and tries to access auth pages, redirect to Home
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone()
    url.pathname = "/home"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}