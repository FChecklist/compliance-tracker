import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getDeploymentSlo, DEFAULT_SLO_WINDOW_DAYS } from "@/lib/services/deployment-slo-service"

// VERIDIAN Review Framework gap-closure, Cloud Deployment / Deployment
// Automation (2026-08-07), "Production Deployment Reliability": exposes
// deployment-slo-service.ts's measured SLO. veridian_admin-gated, same
// posture as /api/ai/team/governance-health -- platform-internal ops data
// (this app's own deploy reliability), not a customer/tenant workflow, so
// no orgId requirement (deploymentEvents has no org_id column, see its own
// schema.ts comment).
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Deployment SLO is veridian_admin-only" }, { status: 403 })
  }

  const windowParam = request.nextUrl.searchParams.get("windowDays")
  const windowDays = windowParam && /^\d+$/.test(windowParam) ? Math.min(Math.max(Number(windowParam), 1), 365) : DEFAULT_SLO_WINDOW_DAYS

  // 2026-09-01 rebase-sweep2b-1021 fix: this GET has real I/O
  // (db.query.deploymentEvents + a best-effort Sentry fetch inside
  // getDeploymentSlo) that can throw on a transient DB/network error --
  // wrap it so callers get a clean JSON 500 instead of Next.js's generic
  // error page, matching this repo's Route Error Handling Check convention.
  try {
    const slo = await getDeploymentSlo(windowDays)
    return NextResponse.json(slo)
  } catch (error) {
    console.error("Deployment SLO computation error:", error)
    return NextResponse.json({ error: "Failed to compute deployment SLO" }, { status: 500 })
  }
}
