import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCacheUtilizationSummary } from "@/lib/prompt-cache/utilization"

// Prompt & Cache Management Framework, Phase 2 (CACHE-05/CACHE-06):
// Phase 1 (2026-07-14) wired prompt_cache_metrics writes but built no
// reader -- this is the first API route that ever queries that table.
// veridian_admin-gated, same posture as the sibling /api/ai/team/token-usage
// report this mirrors (both are platform-wide, cross-org observability,
// not something every authenticated user needs).
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Cache utilization report is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(90, Number(sinceDaysParam) || 30)) : 30

  try {
    const summary = await getCacheUtilizationSummary(sinceDays)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cache utilization summary"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
