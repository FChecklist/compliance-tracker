// R53 Phase 6 -- POST /api/v1/projexa/classify.
//
// *** THIS ENDPOINT NEVER EXECUTES ANYTHING AND NEVER AUTHORIZES ANYTHING. ***
// It answers one question: "if I submitted this text, what would happen?"
// Classifying "approve VO-014" does not approve VO-014. `executed` is always
// false, and it is in the response body so a caller cannot forget.
//
// THE BROWSER PREDICTS, THE SERVER DECIDES. The kit's browser-side Level 0
// may guess a pill instantly for responsiveness; this is the authority that
// re-runs the same ladder server-side. Permission is checked here, and
// checked AGAIN at execution on /submissions -- classification is never a
// permission grant, however confident it is.
//
// Contract frozen in platform.claude_log id 28 (status='r53-handshake') so
// R52 can build the pill strip against it. If the shape must change, a new
// r53-handshake row goes in BEFORE the change, never after.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { classifyOnly } from "@/lib/pipeline/classify-only"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  // READ scope, deliberately. Classifying is a read: it resolves text against
  // a catalogue and writes nothing but the gap_log rows that record what the
  // product could not do. A caller who may not WRITE may still ask what
  // would happen.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
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
    const result = await classifyOnly({
      orgId: ctx.orgId,
      userId: actorId,
      mode: typeof body.mode === "string" ? body.mode : "Projects",
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      rawInput,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("v1 projexa classify error:", error)
    // The backend's own words, never an empty list -- a caller must be able
    // to render WHY, not just that nothing came back.
    const message = error instanceof Error ? error.message : "Failed to classify"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
