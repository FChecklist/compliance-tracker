import { NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { analyzeFunnelWithAI } from "@/lib/services/visitor-intelligence-service"

// Wave 113: on-demand VERIDIAN SALES AI funnel analysis — a real LLM pass
// over the real 30-day funnel via the platform's Layer 1 (task_oa)
// resolution, logged to orchestra_executions. Admin-triggered only: this
// costs tokens, so it runs when a human asks, never on a timer.
export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!hasRole(dbUser, "veridian_admin") || !orgId || !dbUser) {
    return NextResponse.json({ error: "This action requires veridian_admin role" }, { status: 403 })
  }

  try {
    const result = await analyzeFunnelWithAI({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("SALES AI analysis error:", error)
    return NextResponse.json({ error: "Analysis failed — check platform model configuration" }, { status: 500 })
  }
}
