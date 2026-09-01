import { NextResponse } from "next/server"
import { desc, gte, sql } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, applicationErrors } from "@/lib/db"

// Cloud Deployment / Deployment Operations gap-closure, "Performance
// Monitoring" finding (Low): "Monitoring installed but dashboard-usage
// cadence not independently verified." Sentry is wired (sentry.*.config.ts)
// but stays a safe no-op until SENTRY_DSN is provisioned (Owner-blocked,
// see docs/infra/TOOL_INTEGRATION_PLAN.md); its own DB-backed fallback
// (instrumentation.ts's onRequestError -> application_errors, the same
// table this route reads) had zero UI reading it -- there was no dashboard
// to independently verify a usage cadence against in the first place. This
// route is that missing dashboard's data source: real counts + a real
// recent-error feed, admin-gated like every other ops-facing settings
// section (OrgLimitsSection, AdoptionMetricsSection).
//
// Platform-level data (application_errors has no org_id -- an error can
// occur before orgId is even resolved), so this intentionally does not
// scope by the caller's own org; requireAuth() + admin-role gate is the
// access control, same posture as AdoptionMetricsSection's own admin/
// manager gate one level down from "any authenticated user."
export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "admin") {
    return NextResponse.json({ error: "Only admins can view system health" }, { status: 403 })
  }

  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [recent, [{ count: count24h } = { count: 0 }], [{ count: count7d } = { count: 0 }]] = await Promise.all([
      db.query.applicationErrors.findMany({
        orderBy: desc(applicationErrors.createdAt),
        limit: 20,
        columns: { id: true, route: true, message: true, createdAt: true, digestId: true },
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(applicationErrors).where(gte(applicationErrors.createdAt, since24h)),
      db.select({ count: sql<number>`count(*)::int` }).from(applicationErrors).where(gte(applicationErrors.createdAt, since7d)),
    ])

    return NextResponse.json({
      sentryConfigured: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
      count24h,
      count7d,
      recent,
    })
  } catch (error) {
    console.error("System health fetch error:", error)
    return NextResponse.json({ error: "Failed to load system health" }, { status: 500 })
  }
}
