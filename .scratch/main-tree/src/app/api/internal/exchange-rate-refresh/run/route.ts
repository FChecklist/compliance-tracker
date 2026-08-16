import { NextRequest, NextResponse } from "next/server"
import { refreshLiveExchangeRatesForAllOrgs } from "@/lib/services/erp-accounting-service"

/**
 * Cron-triggered entry point (REVIEW-FRAMEWORK-WAVE4 Track 1b item 1): once
 * daily, refresh live exchange rates (open.er-api.com) for every org that
 * has a base currency configured. Same shared-secret pattern as every other
 * /api/internal/*\/run route (e.g. /api/internal/metric-alerts/run) -- there
 * is no user session for a scheduled job.
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
    const result = await refreshLiveExchangeRatesForAllOrgs()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Live exchange-rate refresh run failed:", error)
    return NextResponse.json({ error: "Live exchange-rate refresh run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
