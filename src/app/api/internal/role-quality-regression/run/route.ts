import { NextRequest, NextResponse } from "next/server"
import { runAllRoleQualityChecks } from "@/lib/services/role-quality-regression-service"

/**
 * Cron-triggered entry point for the recurring per-role AI Model quality
 * regression check (VERIDIAN Review Framework gap-closure, "Per-role
 * quality regression tracked over time, not just at launch") -- see
 * role-quality-regression-service.ts's own header for what this runs and
 * how the regression verdict is computed. Same shared-secret pattern as
 * every other /api/internal/*\/run route (no user session for a scheduled
 * job) -- mirrors /api/internal/cost-anomalies/run.
 *
 * Unlike its sibling report-only crons, this one DOES persist (real LLM
 * calls generate real new history that only exists once this runs) -- see
 * role_quality_runs in schema.ts.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const summary = await runAllRoleQualityChecks({ triggeredBy: "scheduled" })
    if (summary.regressions.length > 0) {
      console.warn(
        `[role-quality-regression] ${summary.regressions.length} role(s) regressed this run: ` +
        summary.regressions.map((r) => `${r.roleKey} (${(r.passRate * 100).toFixed(0)}% vs baseline ${((r.baselinePassRate ?? 0) * 100).toFixed(0)}%)`).join(", ")
      )
    }
    return NextResponse.json(summary)
  } catch (error) {
    console.error("Role quality regression run failed:", error)
    return NextResponse.json({ error: "Role quality regression run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
