// "Connect your AI" (src/lib/ai/org-own-ai.ts). The acting person comes from the PROJEXA proxy's X-Acting-User headers, so every rule below is
// applied to THEIR role, not the proxy key's.
//   GET     the picture for this person: who answers their chat (mine / shared with me / my organisation's / PROJEXA's own), what they have
//           connected, what a teammate shared with them, what their organisation connected. Never a key.
//   PUT     { scope: "me" | "org", provider, model?, apiKey } tests and saves a key. "me": any member, for themselves. "org": owner/admin.
//   DELETE  ?scope=me | org   erases that connection (a person's shares go with it). "org": owner/admin.
import { NextRequest, NextResponse } from "next/server"
import { readActingUserEmail, readActingUserId, requireAuthOrApiKey, requireOrg, requireRole, resolveActingUser } from "@/lib/supabase/auth-guard"
import { getAiPicture, OwnAiError, removeMyAi, removeOwnAi, saveMyAi, saveOwnAi } from "@/lib/ai/org-own-ai"
import { isInternalAiAllowedForOrg } from "@/lib/ai/internal-ai-org-allowance"
import { projexaInternalAiEnabled } from "@/lib/projexa-internal-ai"

export const maxDuration = 30

type Ctx = Awaited<ReturnType<typeof requireAuthOrApiKey>>

async function actingPerson(request: NextRequest, ctx: Ctx, bodyEmail?: string) {
  return resolveActingUser(ctx, bodyEmail ?? readActingUserEmail(request), readActingUserId(request))
}

function refuseUnlessAdmin(user: Parameters<typeof requireRole>[0]) {
  return requireRole(user, "admin") ? NextResponse.json({ error: "Only an organisation owner or admin can change the organisation's AI" }, { status: 403 }) : null
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const acting = await actingPerson(request, ctx)
  if (acting.error) return acting.error
  try {
    const projexaOwnAi = projexaInternalAiEnabled() && (await isInternalAiAllowedForOrg(ctx.orgId).catch(() => false))
    return NextResponse.json(await getAiPicture(ctx.orgId, acting.user!.id, projexaOwnAi))
  } catch (error) {
    console.error("v1 projexa own-ai read error:", error)
    return NextResponse.json({ error: "Failed to read the setting" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const body = (await request.json().catch(() => null)) as { scope?: unknown; provider?: unknown; model?: unknown; apiKey?: unknown; actorEmail?: string } | null
  if (!body) return NextResponse.json({ error: "Send the AI company and the key" }, { status: 400 })
  const acting = await actingPerson(request, ctx, body.actorEmail)
  if (acting.error) return acting.error
  const scope = body.scope === "org" ? "org" : "me"
  if (scope === "org") {
    const refusal = refuseUnlessAdmin(acting.user)
    if (refusal) return refusal
  }
  try {
    const key = { provider: body.provider, model: body.model, apiKey: body.apiKey }
    const saved = scope === "org" ? await saveOwnAi(ctx.orgId, key) : await saveMyAi(ctx.orgId, acting.user!.id, key)
    return NextResponse.json(saved)
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
  const acting = await actingPerson(request, ctx)
  if (acting.error) return acting.error
  const scope = new URL(request.url).searchParams.get("scope") === "org" ? "org" : "me"
  if (scope === "org") {
    const refusal = refuseUnlessAdmin(acting.user)
    if (refusal) return refusal
  }
  try {
    return NextResponse.json(scope === "org" ? await removeOwnAi(ctx.orgId) : await removeMyAi(ctx.orgId, acting.user!.id))
  } catch (error) {
    console.error("v1 projexa own-ai delete error:", error)
    return NextResponse.json({ error: "Failed to remove the key" }, { status: 500 })
  }
}
