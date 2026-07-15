// Priority 15 (PROJEXA GRC module, depth pass): thin ALIASING route over
// access-review-service.ts's periodic access-certification cycles.
// GET lists cycles, or (with ?cycleId=) a single cycle's certifications.
// POST opens a new cycle -- createAccessReviewCycle's ctx type was
// extended this same wave to accept a Bearer-key (apiKey) actor, not just
// a session dbUser (see that function's own comment in
// access-review-service.ts), so this is no longer read-only.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listAccessReviewCycles, getAccessReviewCycleDetail, createAccessReviewCycle, ServiceError } from "@/lib/services/access-review-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ cycles: [] })

  try {
    const cycleId = request.nextUrl.searchParams.get("cycleId")
    if (cycleId) {
      const detail = await getAccessReviewCycleDetail({ orgId: ctx.orgId }, cycleId)
      return NextResponse.json({ cycle: detail })
    }
    const cycles = await listAccessReviewCycles({ orgId: ctx.orgId })
    return NextResponse.json({ cycles })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa access-review list error:", error)
    return NextResponse.json({ error: "Failed to fetch access review data" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const cycle = await createAccessReviewCycle(actorCtx, { name: body.name, dueDate: body.dueDate })
    return NextResponse.json(cycle, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa access-review cycle create error:", error)
    return NextResponse.json({ error: "Failed to open access review cycle" }, { status: 500 })
  }
}
