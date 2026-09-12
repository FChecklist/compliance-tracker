import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateReviewReport, getLatestReviewReport, ServiceError } from "@/lib/services/gst-reconciliation-service"
import { AiReviewUnavailableError } from "@/lib/gst/ai-review-report"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ returnPeriodId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all. This is a real, costly AI call over an org's GST
  // financial-reconciliation data -- the established bar for every OTHER
  // write in this exact module (import confirm, reconcile run, returns
  // create -- see /api/gst-reconciliation/{import,reconcile,returns}/
  // route.ts, all requireRole(dbUser, "senior_professional")) is stricter
  // than the generic "member" AI-call floor used elsewhere, because GST
  // reconciliation is financial-compliance data, not routine org data.
  // Matches that real established bar rather than the lower generic one.
  const roleCheck = requireRole(dbUser, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { returnPeriodId } = await ctx.params
    const result = await generateReviewReport({ orgId, userId: dbUser.id, dbUser }, returnPeriodId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof AiReviewUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 })
    console.error("GST AI review error:", error)
    return NextResponse.json({ error: "Failed to generate AI review" }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ returnPeriodId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { returnPeriodId } = await ctx.params
  const report = await getLatestReviewReport({ orgId }, returnPeriodId)
  return NextResponse.json({ report })
}
