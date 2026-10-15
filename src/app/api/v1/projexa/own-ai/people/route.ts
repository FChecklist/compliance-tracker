// "Connect your AI": the teammates a person may share their connection with (name and role only). Any signed-in member.
import { NextRequest, NextResponse } from "next/server"
import { readActingUserEmail, readActingUserId, requireAuthOrApiKey, requireOrg, resolveActingUser } from "@/lib/supabase/auth-guard"
import { listShareCandidates } from "@/lib/ai/org-own-ai"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId(request))
  if (acting.error) return acting.error
  try {
    return NextResponse.json({ people: await listShareCandidates(ctx.orgId, acting.user!.id) })
  } catch (error) {
    console.error("v1 projexa own-ai people error:", error)
    return NextResponse.json({ error: "Failed to list your teammates" }, { status: 500 })
  }
}
