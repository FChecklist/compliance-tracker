import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getTokenUsageSummary } from "@/lib/services/token-usage-service"

// Finance-facing report: real spend, grouped by scope/role/model/org, so
// "where and why" has an actual answer instead of needing to query
// OpenRouter's own billing API by hand (the gap that motivated this
// ledger). veridian_admin-gated, same posture as /api/ai/team/dispatch.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Token usage report is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(90, Number(sinceDaysParam) || 7)) : 7

  try {
    const summary = await getTokenUsageSummary(sinceDays)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load token usage summary"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
