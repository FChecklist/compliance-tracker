// R53 Phase 6 -- POST /api/v1/projexa/submissions.
//
// The full pipeline, in one synchronous request:
//   segment -> classify per segment -> derive chain -> mint pipeline_tasks
//   rows with sequence -> execute -> return what actually happened.
//
// SYNCHRONOUS. NO QUEUE. M26 recommends adding one "only when something
// genuinely outlives a request", and nothing here does -- every function in
// the candidate set completes inside the request that asked for it. A queue
// added before it is needed is machinery to maintain, not capability.
//
// depends_on is set ONLY where a later segment needs an earlier one's
// artifact. In this pipeline the only signal that claims one does is an
// explicit ordering connector ("then" / "and then") or a numbered list. A
// bare "and" gets none, so "PP1 is 50% done and show me the budget" never
// makes the budget read wait on -- or be blocked by -- the progress write.
//
// *** CLASSIFICATION NEVER AUTHORIZES. *** /classify may have said "task";
// this route checks permission again, from scratch, before anything runs.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { runSubmission } from "@/lib/pipeline/run-submission"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  // WRITE scope: this path can record progress, so it is gated as a write
  // even when a particular message turns out to contain only reads. The gate
  // cannot depend on the classification, because the classification is not
  // trusted until after the gate.
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const rawInput = typeof body.rawInput === "string" ? body.rawInput : ""
  if (rawInput.trim().length === 0) {
    return NextResponse.json({ error: "rawInput is required and must be a non-empty string" }, { status: 400 })
  }

  try {
    const result = await runSubmission({
      orgId: ctx.orgId,
      userId: actorId,
      mode: typeof body.mode === "string" ? body.mode : "Projects",
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      selectedChain: body.selectedChain,
      rawInput,
      role: ctx.dbUser?.role ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("v1 projexa submissions error:", error)
    // The backend's own words. An empty list with a 200 would be the
    // silent-empty-200 house pattern E-52 is open on; this is not that.
    const message = error instanceof Error ? error.message : "Failed to run the submission pipeline"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
