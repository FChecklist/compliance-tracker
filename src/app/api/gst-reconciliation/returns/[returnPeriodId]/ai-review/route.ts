import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateReviewReport, getLatestReviewReport, ServiceError } from "@/lib/services/gst-reconciliation-service"
import { AiReviewUnavailableError } from "@/lib/gst/ai-review-report"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ returnPeriodId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

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
