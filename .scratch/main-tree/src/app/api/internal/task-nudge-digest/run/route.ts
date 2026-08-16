import { NextRequest, NextResponse } from "next/server"
import { runTaskNudgeDigest } from "@/lib/services/task-nudge-digest-service"

/**
 * Cron-triggered entry point for tree4-unified U-D25.B1.S1's task nudge
 * digest -- "pushes incomplete tasks toward completion" via a single
 * batched notification per user, software-only (zero LLM call). Same
 * shared-secret pattern as every other /api/internal/*\/run route.
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
    const result = await runTaskNudgeDigest()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Task nudge digest run failed:", error)
    return NextResponse.json({ error: "Task nudge digest run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
