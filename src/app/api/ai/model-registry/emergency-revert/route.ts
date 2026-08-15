import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import {
  getEmergencyRevertStatus,
  activateEmergencyRevert,
  deactivateEmergencyRevert,
} from "@/lib/ai-model-emergency-revert"

// VERIDIAN Review Framework gap-closure (AI Model Lifecycle & Benchmarking,
// "Model deprecation/rollback process defined," 2026-08-15) -- see
// ai-model-emergency-revert.ts's own header for the full investigation
// (why this is not a duplicate of ai_model_registry.status, roster-
// overrides.ts's setRoleOverride/clearRoleOverride, or mother-router.ts's
// rollbackPolicy()). veridian_admin-gated, platform-internal governance
// surface -- same posture as the sibling /api/ai/team/review-registry,
// /api/ai/team/roster/overrides routes (no dedicated page either; matches
// this repo's established API-only convention for this class of surface).
//
// GET returns the current active/inactive state plus the most recent
// activate/deactivate event. POST activates or deactivates it --
// `{ action: "activate" | "deactivate", reason?: string }`.
export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI Model Emergency Revert status is veridian_admin-only" }, { status: 403 })
  }

  try {
    const status = await getEmergencyRevertStatus()
    return NextResponse.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read AI Model Emergency Revert status"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Triggering AI Model Emergency Revert is veridian_admin-only" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const action = (body as { action?: string })?.action
  const reason = (body as { reason?: string })?.reason
  if (action !== "activate" && action !== "deactivate") {
    return NextResponse.json({ error: "action must be 'activate' or 'deactivate'" }, { status: 400 })
  }

  try {
    if (action === "activate") {
      await activateEmergencyRevert(dbUser.id, reason)
    } else {
      await deactivateEmergencyRevert(dbUser.id, reason)
    }
    const status = await getEmergencyRevertStatus()
    return NextResponse.json({ status: "recorded", ...status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update AI Model Emergency Revert state"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
