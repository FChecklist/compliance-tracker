import { NextRequest, NextResponse } from "next/server"
import { logTokenUsage } from "@/lib/services/token-usage-service"

// Secret-gated (not session-auth-gated): the caller is
// scripts/ai-workforce-agent.mjs, running standalone in GitHub Actions
// with no Supabase Auth session and no Postgres access of its own. A
// shared bearer secret (AI_TEAM_LOG_SECRET, GitHub Secret + Vercel env)
// is the whole access model -- deliberately narrower than the read-only
// anon-key approach used for prompt_templates, because this endpoint
// WRITES data Finance needs to trust, not just reads public catalog rows.
export async function POST(request: NextRequest) {
  const secret = process.env.AI_TEAM_LOG_SECRET
  if (!secret) return NextResponse.json({ error: "AI_TEAM_LOG_SECRET not configured" }, { status: 500 })

  const provided = request.headers.get("x-ai-team-secret")
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const { roleKey, model, provider, promptTokens, completionTokens, taskSummary } = body as {
      roleKey?: string
      model?: string
      provider?: string
      promptTokens?: number
      completionTokens?: number
      taskSummary?: string
    }
    if (!model || !provider || typeof promptTokens !== "number" || typeof completionTokens !== "number") {
      return NextResponse.json({ error: "model, provider, promptTokens, completionTokens are required" }, { status: 400 })
    }

    await logTokenUsage({
      scope: "ai_team_internal",
      roleKey: roleKey ?? null,
      taskSummary: taskSummary ?? null,
      provider,
      model,
      usage: { promptTokens, completionTokens },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to log usage"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
