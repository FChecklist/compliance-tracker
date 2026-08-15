import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getLatestRoleQualitySnapshots } from "@/lib/services/model-quality-regression-service"

// AI Model Lifecycle & Benchmarking gap-closure, Finding 1: real per-role
// quality-regression time series (role_quality_snapshots, populated by the
// recurring job piggybacked on GET /api/internal/loops/run -- see
// model-quality-regression-service.ts's own header for the full
// investigation trail). veridian_admin-gated, platform-internal governance
// surface, same posture as /api/ai/team/scorecard and
// /api/ai/team/governance-health.
export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Model quality regression tracking is veridian_admin-only" }, { status: 403 })
  }

  try {
    const snapshots = await getLatestRoleQualitySnapshots()
    return NextResponse.json({
      snapshots,
      regressedRoleCount: snapshots.filter((s) => s.regressionDetected).length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load role quality snapshots"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
