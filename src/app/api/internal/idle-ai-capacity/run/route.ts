import { NextRequest, NextResponse } from "next/server"
import { findIdleAiCapacity } from "@/lib/services/idle-ai-capacity-service"

/**
 * Cron-triggered entry point for the quarterly Idle AI Capacity report
 * (AI Cost Governance & FinOps gap-closure, 2026-07-18) -- see
 * idle-ai-capacity-service.ts's own header for what "provisioned but not
 * consumed" means here (customerModelConfig/clientModelConfig rows with a
 * real API key, unused for 90+ days). Same shared-secret pattern as every
 * other /api/internal/*\/run route (no user session for a scheduled job).
 *
 * No persistence layer, same honestly-disclosed scope limit as its
 * siblings: this computes and returns the report, there is no
 * dashboard/inbox surface to read it from later -- matches the task's own
 * recommended approach ("simple quarterly query, not worth dedicated
 * tooling at current scale").
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
    const report = await findIdleAiCapacity()
    return NextResponse.json(report)
  } catch (error) {
    console.error("Idle AI capacity report run failed:", error)
    return NextResponse.json({ error: "Idle AI capacity report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
