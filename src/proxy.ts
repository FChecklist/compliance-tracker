import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { PROTECTED_APP_ROUTE_PREFIXES } from "@/lib/protected-routes.generated"

// PROJEXA server-merge Phase 1 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): 7 of
// PROJEXA's top-level route segments collide with a DIFFERENT existing
// compliance-tracker feature of the same name (dashboard = compliance
// posture here, construction financials there; same clash for documents/
// hr/knowledge-base/reports/settings/recruitment -- see the plan's own
// inventory). Rather than a product-merge decision on all 7 at once, each
// gets a physically distinct page under src/app/(app)/px/<name>/ (NOT
// "_projexa" -- Next.js treats an underscore-prefixed segment as a private
// folder and refuses to route it at all, confirmed against the App Router
// docs before picking this name), and PROJEXA's own production host is
// rewritten here so its visitors see the clean, unprefixed URL while every
// other host keeps compliance-tracker's own page at that path untouched.
// A direct visit to /px/<name> on any host also just works (Next.js routes
// it like any other real page) -- the rewrite only exists for a clean URL,
// it is not the only way in.
const PROJEXA_HOSTS = new Set(["projexa-ai.com", "www.projexa-ai.com"])
const PROJEXA_SHADOW_SEGMENTS = new Set([
  "dashboard", "documents", "hr", "knowledge-base", "reports", "settings", "recruitment",
])

/**
 * Pure (no request/response objects, no Supabase call) so it's unit tested
 * directly in proxy.test.ts rather than only indirectly through a full
 * middleware run with a mocked Supabase client. Returns the internal path to
 * rewrite to, or null when this host/path should render compliance-tracker's
 * own page unchanged.
 */
export function resolveProjexaRewriteTarget(host: string, pathname: string): string | null {
  const normalizedHost = host.split(":")[0]?.toLowerCase() ?? ""
  const topSegment = pathname.split("/")[1]
  if (PROJEXA_HOSTS.has(normalizedHost) && PROJEXA_SHADOW_SEGMENTS.has(topSegment)) {
    return `/px${pathname}`
  }
  return null
}

export async function proxy(request: NextRequest) {
  // publicPathname is what a visitor actually typed/clicked and what every
  // redirect this function builds must echo back (login/mfa-challenge's
  // redirectTo) -- rewriteTarget (below, computed but not yet applied) is
  // the internal path PROJEXA's own host renders instead, applied ONLY on
  // the final pass-through response, deliberately AFTER every auth check
  // below runs against the real, original pathname. Note /px/<name> does
  // NOT need special handling in the isAppRoute check further down: the
  // public segment (/dashboard, /documents, ...) is already a protected
  // compliance-tracker route in its own right, so the existing check
  // already gates it correctly without knowing a rewrite is about to
  // happen -- this function does not mutate request.nextUrl at all.
  const publicPathname = request.nextUrl.pathname
  const rewriteTarget = resolveProjexaRewriteTarget(request.headers.get("host") ?? "", publicPathname)

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
    // publicPathname, not request.nextUrl.pathname: the latter may be the
    // internal /px/<name> rewrite target, which a PROJEXA visitor has never
    // seen in their own address bar and must not see here either.
    url.searchParams.set("redirectTo", publicPathname)
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
      url.searchParams.set("redirectTo", publicPathname)
      return NextResponse.redirect(url)
    }
  }

  // If user is logged in and tries to access auth pages, redirect to Home
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone()
    url.pathname = "/home"
    return NextResponse.redirect(url)
  }

  // The real rewrite, applied last and only once every auth/MFA check above
  // has already passed against the real, public pathname: NextResponse.
  // rewrite() serves a different page's content while leaving the visitor's
  // own address bar and browser history exactly as they were (the documented
  // behaviour of .rewrite() vs .redirect()). Cookies the Supabase SSR flow
  // above may have refreshed on supabaseResponse must be carried onto this
  // new response object, or a session refresh mid-request would be silently
  // dropped for every PROJEXA-hosted request that reaches this branch.
  if (rewriteTarget) {
    const rewritten = NextResponse.rewrite(new URL(rewriteTarget + request.nextUrl.search, request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => rewritten.cookies.set(cookie))
    return rewritten
  }

  return supabaseResponse
}

export const config = {
  // dpdp/api/dpdp excluded: WO-DPDP-002 Section 5 (blast-radius) --
  // dpdp-session.ts is a fully separate auth plane (its own `dpdp_session`
  // cookie, own dpdp.identity/dpdp.session tables, never touches Supabase
  // Auth), so this proxy's unconditional createServerClient()+getUser()
  // call was a real, avoidable shared-fate risk: a Supabase Auth outage or
  // misconfiguration affecting the rest of this app would otherwise also
  // break every /dpdp page load, for no reason -- DPDP never needed this
  // middleware's session-refresh/redirect behavior in the first place.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|dpdp|api/dpdp|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}