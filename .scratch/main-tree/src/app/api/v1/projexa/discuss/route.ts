// Wave 132: free-form Discuss chat for PROJEXA, separate from the
// deterministic assistant/route.ts (whitelisted codeReferences via
// dispatchTool()). This is genuine conversational LLM chat -- no live
// project data passed in, see construction-ai-service.ts's discussConstruction().
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { discussConstruction, ServiceError } from "@/lib/services/construction-ai-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })
    const history = Array.isArray(body.history) ? body.history : []
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

    const result = await discussConstruction({ orgId: ctx.orgId, userId: actorId }, message, history)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa discuss error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate a reply"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
