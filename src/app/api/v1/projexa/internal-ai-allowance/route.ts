// P6 (aims 5-6): the organisation owner's switch for PROJEXA's own AI. GET reads it (any signed-in person of the organisation, so the
// Settings card can show the state); PUT changes it and is limited to the organisation's owner/admin role. The acting person comes
// from the PROJEXA proxy's X-Acting-User headers (resolveActingUser), so a member's request is refused on THEIR role, not the key's.
import { NextRequest, NextResponse } from "next/server"
import { readActingUserEmail, readActingUserId, requireAuthOrApiKey, requireOrg, requireRole, resolveActingUser } from "@/lib/supabase/auth-guard"
import { getInternalAiAllowance, InternalAiAllowanceError, setInternalAiAllowance } from "@/lib/ai/internal-ai-org-allowance-admin"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  try {
    return NextResponse.json(await getInternalAiAllowance(ctx.orgId))
  } catch (error) {
    console.error("v1 projexa internal-ai-allowance read error:", error)
    return NextResponse.json({ error: "Failed to read the setting" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const body = (await request.json().catch(() => null)) as { allowed?: unknown; actorEmail?: string } | null
  if (typeof body?.allowed !== "boolean") return NextResponse.json({ error: "allowed must be true or false" }, { status: 400 })

  const acting = await resolveActingUser(ctx, body.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
  if (acting.error) return acting.error
  const roleErr = requireRole(acting.user, "admin")
  if (roleErr) return NextResponse.json({ error: "Only an organisation owner or admin can change this" }, { status: 403 })

  try {
    const state = await setInternalAiAllowance({ orgId: ctx.orgId, userId: acting.user!.id, dbUser: acting.user! }, body.allowed)
    return NextResponse.json(state)
  } catch (error) {
    if (error instanceof InternalAiAllowanceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa internal-ai-allowance write error:", error)
    return NextResponse.json({ error: "Failed to save the setting" }, { status: 500 })
  }
}
