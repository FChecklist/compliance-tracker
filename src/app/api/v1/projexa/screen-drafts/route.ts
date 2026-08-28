// R42 seq21/22 -- the generic draft-lifecycle API (M29), wired to
// draft-service.ts (seq20). Module-agnostic by design: any function_id can
// start a draft through this one route; "activate" (Save) stays owned by
// each module's own write route (permits/[id] PATCH, etc.) since only that
// route knows how to validate+write its own active table -- see that
// route's own header comment.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, requireOrg } from "@/lib/supabase/auth-guard"
import { startDraft, DraftLockedError } from "@/lib/screens/draft-service"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { screenDrafts } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const orgErr = requireOrg(ctx)
  if (orgErr) return orgErr

  const functionId = request.nextUrl.searchParams.get("functionId")
  const objectId = request.nextUrl.searchParams.get("objectId")
  if (!functionId) return NextResponse.json({ error: "functionId is required" }, { status: 400 })

  const draft = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.screenDrafts.findFirst({
      where: objectId ? and(eq(screenDrafts.functionId, functionId), eq(screenDrafts.objectId, objectId)) : and(eq(screenDrafts.functionId, functionId)),
    })
  )
  return NextResponse.json({ draft: draft ?? null })
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  if (typeof body.functionId !== "string") return NextResponse.json({ error: "functionId is required" }, { status: 400 })
  // R42 seq21 live-oracle finding: same shared-API-key gap already fixed on
  // timesheets submit/approve/reject -- see resolveActingUser()'s doc comment.
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr

  try {
    const draft = await startDraft({
      orgId: ctx.orgId,
      userId: actingUser!.id,
      functionId: body.functionId,
      objectId: typeof body.objectId === "string" ? body.objectId : null,
      initialPayload: body.initialPayload ?? {},
    })
    return NextResponse.json(draft, { status: 201 })
  } catch (error) {
    if (error instanceof DraftLockedError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error("screen-drafts create error:", error)
    return NextResponse.json({ error: "Failed to start draft" }, { status: 500 })
  }
}
