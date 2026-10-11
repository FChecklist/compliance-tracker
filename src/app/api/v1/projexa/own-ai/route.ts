// "Connect your AI": the organisation's own AI key (src/lib/ai/org-own-ai.ts). GET tells any signed-in person of the organisation whether
// an AI is connected (never the key); PUT tests and saves a key, DELETE removes it, both limited to the organisation's owner/admin.
// The acting person comes from the PROJEXA proxy's X-Acting-User headers, so a member is refused on THEIR role, not the key's.
import { NextRequest, NextResponse } from "next/server"
import { readActingUserEmail, readActingUserId, requireAuthOrApiKey, requireOrg, requireRole, resolveActingUser } from "@/lib/supabase/auth-guard"
import { getOwnAiStatus, OwnAiError, removeOwnAi, saveOwnAi } from "@/lib/ai/org-own-ai"

export const maxDuration = 30

async function adminOrRefusal(request: NextRequest, ctx: Awaited<ReturnType<typeof requireAuthOrApiKey>>, bodyEmail?: string) {
  const acting = await resolveActingUser(ctx, bodyEmail ?? readActingUserEmail(request), readActingUserId(request))
  if (acting.error) return { response: acting.error }
  const roleErr = requireRole(acting.user, "admin")
  if (roleErr) return { response: NextResponse.json({ error: "Only an organisation owner or admin can change this" }, { status: 403 }) }
  return { response: null }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  try {
    return NextResponse.json(await getOwnAiStatus(ctx.orgId))
  } catch (error) {
    console.error("v1 projexa own-ai read error:", error)
    return NextResponse.json({ error: "Failed to read the setting" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const body = (await request.json().catch(() => null)) as { provider?: unknown; model?: unknown; apiKey?: unknown; actorEmail?: string } | null
  if (!body) return NextResponse.json({ error: "Send the AI company and the key" }, { status: 400 })
  const gate = await adminOrRefusal(request, ctx, body.actorEmail)
  if (gate.response) return gate.response
  try {
    return NextResponse.json(await saveOwnAi(ctx.orgId, body))
  } catch (error) {
    if (error instanceof OwnAiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa own-ai write error:", error)
    return NextResponse.json({ error: "Failed to save the setting" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const gate = await adminOrRefusal(request, ctx)
  if (gate.response) return gate.response
  try {
    return NextResponse.json(await removeOwnAi(ctx.orgId))
  } catch (error) {
    console.error("v1 projexa own-ai delete error:", error)
    return NextResponse.json({ error: "Failed to remove the key" }, { status: 500 })
  }
}
