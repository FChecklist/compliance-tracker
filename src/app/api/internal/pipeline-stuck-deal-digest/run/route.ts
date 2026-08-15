import { NextRequest, NextResponse } from "next/server"
import { runPipelineStuckDealDigest } from "@/lib/services/pipeline-stuck-deal-digest-service"

/**
 * Cron-triggered entry point for the Sales Pipeline "deal stuck in stage X
 * for 30 days" digest -- one batched notification per deal owner, zero LLM
 * call. Same shared-secret pattern as every other /api/internal/*\/run
 * route (see task-nudge-digest/run/route.ts, the pattern this mirrors).
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
    const result = await runPipelineStuckDealDigest()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Pipeline stuck-deal digest run failed:", error)
    return NextResponse.json({ error: "Pipeline stuck-deal digest run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
