import { NextRequest, NextResponse } from "next/server"
import { autoScoreNewOrStaleLeadsForAllOrgs } from "@/lib/services/crm-service"

/**
 * Cron-triggered entry point (VERIDIAN Review Framework gap-closure,
 * "AI Copilot / Worker Agent Integration Depth"): scoring was manual-only
 * (a click per lead in the UI). Once daily, auto-score new/stale leads for
 * every org with Sales enabled, matching the internal/* cron pattern used
 * elsewhere (e.g. /api/internal/exchange-rate-refresh/run) -- same
 * shared-secret auth, since there is no user session for a scheduled job.
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
    const result = await autoScoreNewOrStaleLeadsForAllOrgs()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("CRM lead auto-scoring run failed:", error)
    return NextResponse.json({ error: "CRM lead auto-scoring run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
