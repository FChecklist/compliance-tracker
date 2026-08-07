import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { approveLoopImprovement, dismissLoopImprovement, ServiceError } from "@/lib/services/loop-improvement-review-service"

// The write half of the review queue -- mirrors /api/ai/team/
// capability-improvements/[id]'s own single-POST-plus-action-discriminator
// shape (see that route's header for the reasoning: both actions operate on
// the same resource-by-id and share the same auth/lookup guard).
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Acting on a loop improvement proposal is veridian_admin-only" }, { status: 403 })
  }

  const { id } = await context.params
  const body = await request.json()
  const { action, notes } = body as { action?: "approve" | "dismiss"; notes?: string }

  try {
    if (action === "approve") {
      await approveLoopImprovement(id, dbUser.id, notes)
      return NextResponse.json({ reviewDecision: "approved" })
    }

    if (action === "dismiss") {
      await dismissLoopImprovement(id, dbUser.id, notes)
      return NextResponse.json({ reviewDecision: "dismissed" })
    }

    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error(`Loop improvement review action failed for ${id}:`, err)
    return NextResponse.json({ error: "Action failed" }, { status: 500 })
  }
}
