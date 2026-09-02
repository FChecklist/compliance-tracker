// R67 lane B (B-03) -- GET /api/v1/projexa/chain-options.
//
// The level after the pill. PROJEXA's composer could start a chain and could
// run a finished one, and had nothing to ask in between; this answers "the
// user has picked Work Progress and Record progress -- what are their real
// choices?" with the project's own records.
//
// Guarded exactly as tasks/route.ts is (requireAuthOrApiKey +
// requireRoleOrScope 'member'/'read'). READ ONLY: it mints nothing, runs
// nothing, and its answer is a HINT -- POST /api/v1/projexa/tasks
// re-validates permission and existence when the user actually submits.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { buildChainOptions, makeChainOptionsRepo } from "@/lib/services/chain-options-service"

/** `path` is a JSON array of the segments already chosen, e.g. ["work_progress","record_progress"]. */
function parsePath(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 6)
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  const url = new URL(request.url)
  const path = parsePath(url.searchParams.get("path"))
  const projectId = url.searchParams.get("projectId")

  try {
    const repo = makeChainOptionsRepo({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey?.id })
    const result = await buildChainOptions({ path, projectId }, repo)
    return NextResponse.json({ path, projectId, ...result })
  } catch (error) {
    console.error("v1 projexa chain-options GET error:", error)
    const message = error instanceof Error ? error.message : "Failed to read the next options"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
