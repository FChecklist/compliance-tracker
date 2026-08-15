import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import {
  runModelLifecycleReviewCycle,
  getModelLifecycleHistory,
  getLatestModelLifecycleReviews,
  getModelsNeedingTrustTierReconsideration,
  getModelsNeedingUrgentReview,
} from "@/lib/services/model-lifecycle-service"

// AI Model Lifecycle & Benchmarking: Ongoing Quality Monitoring -- see
// model-lifecycle-service.ts's own header for the full investigation trail
// (why this is not a duplicate of model-scorecard-service.ts/GAP-MODEL-
// SCORECARD, and how it reuses agent-review-service.ts's verdict math at
// model instead of role granularity). veridian_admin-gated, platform-
// internal governance surface -- same posture as the sibling
// /api/ai/team/scorecard, /review-registry, /governance-health, /d1-metrics,
// /token-usage routes (none of which have a dedicated page either).
//
// GET reads the persisted registry -- either one model's full history
// (?model=...), every (model, complexityTier)'s latest verdict (default),
// the ones currently flagged for a Rule 10 trust-tier reconsideration
// (?flagged=true), or the sharpest cut -- mandatory-audit-gated models
// currently verdict='deprecate'|'retrain' (?urgent=true). POST runs a new
// review cycle and persists its results -- no automated cron trigger yet,
// same honestly-deferred posture as /review-registry (this repo has
// already hit the Vercel Hobby plan's once-per-day cron limit); a
// veridian_admin (or a future scheduled job reusing this route) runs it on
// demand.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Model Lifecycle Registry is veridian_admin-only" }, { status: 403 })
  }

  const model = request.nextUrl.searchParams.get("model")
  const flaggedOnly = request.nextUrl.searchParams.get("flagged") === "true"
  const urgentOnly = request.nextUrl.searchParams.get("urgent") === "true"
  const limitParam = request.nextUrl.searchParams.get("limit")
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : 50

  try {
    if (model) {
      const history = await getModelLifecycleHistory(model, limit)
      return NextResponse.json({ model, history })
    }
    if (urgentOnly) {
      const urgent = await getModelsNeedingUrgentReview()
      return NextResponse.json({ urgent })
    }
    if (flaggedOnly) {
      const flagged = await getModelsNeedingTrustTierReconsideration()
      return NextResponse.json({ flagged })
    }
    const latest = await getLatestModelLifecycleReviews()
    return NextResponse.json({ latest })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the Model Lifecycle Registry"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Triggering a Model Lifecycle review cycle is veridian_admin-only" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const sinceDaysRaw = (body as { sinceDays?: number })?.sinceDays
  const sinceDays = sinceDaysRaw ? Math.max(1, Math.min(365, Number(sinceDaysRaw) || 30)) : 30

  try {
    const created = await runModelLifecycleReviewCycle({ sinceDays })
    return NextResponse.json({ status: "recorded", reviewedGroupCount: created.length, records: created })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run a Model Lifecycle review cycle"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
