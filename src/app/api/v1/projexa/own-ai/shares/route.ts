// "Connect your AI": POST { userIds } replaces the teammates who may use MY connection (src/lib/ai/org-own-ai.ts setMyShares). Any member, for their
// own connection only: the connection is looked up by the acting person, never by an id in the request.
import { NextRequest, NextResponse } from "next/server"
import { readActingUserEmail, readActingUserId, requireAuthOrApiKey, requireOrg, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { OwnAiError, setMyShares } from "@/lib/ai/org-own-ai"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const body = (await request.json().catch(() => null)) as { userIds?: unknown; actorEmail?: string } | null
  const acting = await resolveActingUser(ctx, body?.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
  if (acting.error) return acting.error
  try {
    return NextResponse.json(await setMyShares(ctx.orgId, acting.user!.id, body?.userIds))
  } catch (error) {
    if (error instanceof OwnAiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa own-ai shares error:", error)
    return NextResponse.json({ error: "Failed to save who can use your AI" }, { status: 500 })
  }
}
