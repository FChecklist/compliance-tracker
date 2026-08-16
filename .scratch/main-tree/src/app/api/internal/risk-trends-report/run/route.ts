import { NextRequest, NextResponse } from "next/server"
import { generateRiskTrendsReport } from "@/lib/services/report-cadence-service"

/**
 * Cron-triggered entry point for the Risk-Trends report (GAP-D19-REPORT-
 * CADENCES, tree4-unified U-D19.B1.S1) -- see report-cadence-service.ts's
 * own header for exactly what's real and how it's sourced. Same shared-
 * secret pattern as every other /api/internal/*\/run route -- mirrors
 * /api/internal/ai-performance-report/run.
 *
 * Runs daily (see vercel.json) but defaults to a 7-day lookback window --
 * a single day rarely shows a "trend"; the cadence is daily, the window
 * isn't. No persistence layer, same honestly-disclosed scope limit as the
 * daily AI-performance report this mirrors.
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
    const report = await generateRiskTrendsReport(7)
    return NextResponse.json({ ranAt: new Date().toISOString(), report })
  } catch (error) {
    console.error("Risk-Trends report run failed:", error)
    return NextResponse.json({ error: "Risk-Trends report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
