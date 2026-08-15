import { NextRequest, NextResponse } from "next/server"
import { takeAiReductionSnapshot } from "@/lib/services/ai-reduction-service"

/**
 * Cron-triggered entry point for the monthly AI-reduction snapshot
 * (VERIDIAN Review Framework remediation, "No metric tracks whether AI
 * usage/dependence decreases over time") -- see ai-reduction-service.ts's
 * own header for exactly what this measures and how. Same shared-secret
 * pattern as every other /api/internal/*\/run route (no user session for a
 * scheduled job). Scheduled for the 1st of each month, vercel.json.
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
    const snapshot = await takeAiReductionSnapshot()
    return NextResponse.json({ ranAt: new Date().toISOString(), snapshot })
  } catch (error) {
    console.error("AI-reduction snapshot run failed:", error)
    return NextResponse.json({ error: "AI-reduction snapshot run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
