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
    "/approvals", "/audit", "/audit-engagements", "/bcm", "/board", "/board-evaluation",
    "/cap-table", "/charges", "/chat", "/checklists", "/clients", "/committees",
    "/compliance", "/contract-compliance", "/dashboard", "/departments", "/directors",
    "/doa", "/esg", "/frameworks", "/help", "/home", "/hr-compliance", "/incidents",
    "/ingest", "/ip-portfolio", "/irdai", "/leave-holiday", "/legal-opinions",
    "/legal-vendors", "/litigation", "/mca-filings", "/notices", "/orchestra",
    "/penalties", "/pms", "/policies", "/posh", "/rbi", "/reports", "/risks", "/rpt",
    "/sebi", "/secretarial-audit", "/settings", "/statutory-registers", "/tasks",
    "/team", "/users", "/vendor-risk", "/whistleblower",
  ]
  const isAppRoute = PROTECTED_APP_ROUTE_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirectTo", request.nextUrl.pathname)
    return NextResponse.redirect(url)
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