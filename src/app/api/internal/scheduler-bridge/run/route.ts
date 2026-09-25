import { createHash, timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { runDueSchedules } from "@/lib/pipeline/scheduler-bridge"

// A run starts no new schedule after 45 s (DEFAULT_TIME_BUDGET_MS in scheduler-bridge.ts). 60 s leaves room for the schedule in
// flight and is the most a Vercel Hobby project allows; the Edge Function waits 100 s for this route.
export const maxDuration = 60

/**
 * PROJEXA-BUILD-001 U-40 (BR-515): the last hop of the scheduler bridge. The pg_cron job projexa-scheduler-bridge posts to the
 * Edge Function of the same name (supabase/functions/projexa-scheduler-bridge), which calls this route with
 * `Authorization: Bearer ${SCHEDULER_BRIDGE_INTERNAL_SECRET}` when at least one schedule is due. The cron command never names this
 * path (register row BR-516).
 *
 * There is no user session for a scheduled job, so this route has no session guard: the shared secret is its auth, checked
 * below the way the other /api/internal/*\/run routes check theirs (the same Bearer form), with two differences: the secret has
 * its own name, and the comparison is constant time on sha256 digests. A missing or short secret refuses every call.
 *
 * What it does is in src/lib/pipeline/scheduler-bridge.ts: it runs each due schedule as the schedule's owner (never as an API
 * key), runs reads, and turns every write into a proposal that a person approves (PMD-05). The response is counts and per-schedule
 * outcome codes only: no parameter, no result body, no name.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.SCHEDULER_BRIDGE_INTERNAL_SECRET
  if (!secret || secret.length < 24) return false
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim())
  const presented = match?.[1]?.trim() ?? ""
  if (presented.length === 0) return false
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest()
  return timingSafeEqual(digest(presented), digest(secret))
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const summary = await runDueSchedules()
    return NextResponse.json(summary)
  } catch (error) {
    console.error("Scheduler bridge run failed:", error)
    return NextResponse.json({ error: "Scheduler bridge run failed" }, { status: 500 })
  }
}
