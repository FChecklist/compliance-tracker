import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

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

  // Protected routes: redirect to login if not authenticated. Kept as an
  // explicit allowlist mirroring every directory under src/app/(app)/ --
  // confirmed via a live audit (2026-07-04) that this list had drifted
  // badly out of sync with that directory over many waves of new GRC
  // module pages (34 of 51 route groups were missing, including /posh and
  // /whistleblower -- unauthenticated requests got a real 200 page shell
  // instead of a redirect; no data actually leaked since every fetch
  // inside those pages goes through requireAuth()-gated API routes, but
  // this defense-in-depth layer was silently absent). Any new page added
  // under src/app/(app)/ must be added here too.
  const PROTECTED_APP_ROUTE_PREFIXES = [
    "/access-review", "/approvals", "/audit", "/audit-engagements", "/automation", "/bcm", "/board", "/board-evaluation",
    "/cap-table", "/capability-registry", "/charges", "/chat", "/checklists", "/clients", "/committees", "/crm", "/documents", "/erp", "/fde", "/fraud-cases", "/hr",
    "/compliance", "/contract-compliance", "/dashboard", "/departments", "/directors",
    "/doa", "/esg", "/frameworks", "/help", "/home", "/hr-compliance", "/incidents",
    "/ingest", "/ip-portfolio", "/irdai", "/it-dr", "/knowledge-base", "/kpi-hub", "/leave-holiday", "/legal-matters", "/legal-opinions",
    "/legal-vendors", "/litigation", "/mca-filings", "/mdm-quality", "/metric-alerts", "/notices", "/orchestra",
    "/penalties", "/performance-reviews", "/pms", "/policies", "/posh", "/problem-records", "/prompt-eval", "/rbi", "/recruitment", "/reports", "/risks", "/rpt",
    "/sales-hq", "/sebi", "/secretarial-audit", "/settings", "/statutory-registers", "/tasks", "/tickets",
    "/team", "/users", "/vendor-risk", "/veri-ai", "/veri-meetings", "/veri-todo", "/whistleblower",
  ]
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