import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLoopImprovements, type ReviewFilter } from "@/lib/services/loop-improvement-review-service"

const VALID_FILTERS: ReviewFilter[] = ["pending", "approved", "dismissed", "all"]

// veridian_admin-gated, same posture as /api/ai/team/capability-improvements
// (see that route's own header) -- loop_improvements is platform-wide
// governance data (what the self-improvement loops found), not a customer
// workflow.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "The loop improvement review queue is veridian_admin-only" }, { status: 403 })
  }

  const filterParam = request.nextUrl.searchParams.get("filter")
  if (filterParam && !VALID_FILTERS.includes(filterParam as ReviewFilter)) {
    return NextResponse.json({ error: `filter must be one of ${VALID_FILTERS.join(", ")}` }, { status: 400 })
  }

  const improvements = await listLoopImprovements((filterParam as ReviewFilter | null) ?? "pending")
  return NextResponse.json({ improvements })
}
