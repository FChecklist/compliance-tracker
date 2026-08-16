import { NextRequest, NextResponse } from "next/server"
import { generateDueOccurrences } from "@/lib/services/fm-ppm-service"

/**
 * Cron-triggered entry point for Wave 107's PPM occurrence generation
 * (VERI FM & CS AI OS) -- rolling 14-day-lookahead generation across every
 * org (see generateDueOccurrences()'s own comment for why this is
 * cron-driven-batch rather than lazy or eager-forever). Same shared-secret
 * pattern as /api/internal/loops/run, /api/internal/instruction-audit/run,
 * and /api/internal/metric-alerts/run -- there is no user session for a
 * scheduled job.
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
    const result = await generateDueOccurrences()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("FM PPM occurrence generation run failed:", error)
    return NextResponse.json({ error: "FM PPM occurrence generation run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
