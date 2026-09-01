import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getRoleQualityHistory, runRoleQualityCheck } from "@/lib/services/role-quality-regression-service"

// Per-role quality regression history (VERIDIAN Review Framework gap-
// closure, "Per-role quality regression tracked over time"). veridian_
// admin-gated, platform-internal governance surface, same posture as
// /api/ai/team/scorecard and /api/ai/team/token-usage.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Role quality history is veridian_admin-only" }, { status: 403 })
  }

  const roleKey = request.nextUrl.searchParams.get("roleKey")
  if (!roleKey) return NextResponse.json({ error: "roleKey query param is required" }, { status: 400 })

  const limitParam = request.nextUrl.searchParams.get("limit")
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam) || 20)) : 20

  try {
    const runs = await getRoleQualityHistory(roleKey, limit)
    return NextResponse.json({ roleKey, runs })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load role quality history"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Manual re-run for one role (e.g. right after a prompt promotion, to
// confirm the new production version didn't regress before the next
// scheduled sweep picks it up).
export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Role quality check is veridian_admin-only" }, { status: 403 })
  }

  try {
    const body = await request.json()
    if (!body?.roleKey) return NextResponse.json({ error: "roleKey is required" }, { status: 400 })
    const result = await runRoleQualityCheck(body.roleKey, { triggeredBy: "manual" })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run role quality check"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
