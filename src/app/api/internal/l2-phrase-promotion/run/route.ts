import { NextRequest, NextResponse } from "next/server"
import { runL2Batch } from "@/lib/ai/batch/analyse"

/**
 * Cron-triggered entry point (R42 seq15, M26 P6). Same shared-secret pattern
 * as every other /api/internal/*\/run route (e.g.
 * /api/internal/exchange-rate-refresh/run) -- there is no user session for a
 * scheduled job. NIGHTLY ONLY -- this is the one scheduler v5 P-1 explicitly
 * authorises; nothing else in this pipeline may add a queue/worker/trigger.
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
    const result = await runL2Batch()
    return NextResponse.json(result)
  } catch (error) {
    console.error("L2 phrase-promotion batch run failed:", error)
    return NextResponse.json({ error: "L2 phrase-promotion batch run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
