import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { closeImprovementLoop, rejectImprovementProposal, ServiceError } from "@/lib/services/capability-audit-service"

// Priority 12 (OPEN-07 point 5): the write half of the capability-
// improvement-proposals feedback surface -- the two actions a human reviewer
// can take on an open/dispatched proposal, mirroring closeImprovementLoop()/
// rejectImprovementProposal()'s own exact split in capability-audit-
// service.ts. veridian_admin-gated, same posture as the sibling GET route
// (see ./route.ts's header).
//
// A single POST + body `action` discriminator rather than two routes
// (/close, /reject) -- both actions operate on the same resource (one
// proposal, by id) and share the same auth/lookup shape; a body-driven
// branch keeps that in one file instead of duplicating the guard.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Acting on a capability improvement proposal is veridian_admin-only" }, { status: 403 })
  }

  const { id } = await context.params
  const body = await request.json()
  const { action, prUrl, reason } = body as { action?: "close" | "reject"; prUrl?: string; reason?: string }

  try {
    if (action === "close") {
      if (!prUrl?.trim()) {
        return NextResponse.json({ error: "prUrl is required to close a proposal -- closeImprovementLoop() records it as the real fix that resolved this gap." }, { status: 400 })
      }
      await closeImprovementLoop(id, prUrl.trim())
      return NextResponse.json({ status: "resolved" })
    }

    if (action === "reject") {
      if (!reason?.trim() || reason.trim().length < 10) {
        return NextResponse.json({ error: "A real reason (at least 10 characters) is required -- this becomes the permanent record of why this finding was not acted on, not a rubber stamp." }, { status: 400 })
      }
      await rejectImprovementProposal(id, reason.trim())
      return NextResponse.json({ status: "rejected" })
    }

    return NextResponse.json({ error: "action must be 'close' or 'reject'" }, { status: 400 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error(`Capability improvement proposal action failed for ${id}:`, err)
    return NextResponse.json({ error: "Action failed" }, { status: 500 })
  }
}
