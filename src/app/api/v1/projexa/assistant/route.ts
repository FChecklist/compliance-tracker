// Wave 129: structured "ask a construction question" surface for PROJEXA.
// Calls task-execution-engine.ts's dispatchTool() directly with an explicit
// codeReference -- the same deterministic dispatch mechanism VeriComposer's
// Mode Pills + Chain Selector uses (see capability-tree-service.ts's
// buildConstructionNodes(), Wave 128), just reached via REST instead of a
// tree click. Deliberately scoped to ONLY the 7 construction codeReferences
// registered in Wave 128 -- this endpoint is not a general dispatchTool()
// proxy for every worker agent on the platform (compliance/GST/etc stay
// reachable only through their own surfaces).
//
// R42 seq14 (M25 pipeline): ADDITIVE, not a replacement. When the request
// body carries `rawInput` instead of `codeReference`, this route runs the
// new submission -> segmentation -> task pipeline instead of the codeReference
// dispatch above. The old codeReference path is byte-for-byte unchanged --
// R-80/R-82/R-90 (Sumeet requirements, verified live this same work order)
// depend on it working exactly as before, and a full replacement of this
// route (as the work order's own "how" literally reads) would have
// regressed real, already-shipped, already-verified functionality. Said so
// here rather than silently deviating, per the work order's own instruction.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { dispatchTool } from "@/lib/task-execution-engine"
import { runSubmission } from "@/lib/pipeline/run-submission"

const ALLOWED_CODE_REFERENCES = [
  "get_construction_project_dashboard",
  "list_delayed_activities",
  "get_construction_budget_status",
  "list_over_budget_projects",
  "get_construction_kpi_status",
  "generate_construction_progress_summary",
  "detect_construction_budget_schedule_risk",
]

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  // New pipeline path (R42 seq14).
  if (typeof body.rawInput === "string") {
    const roleErr = requireRoleOrScope(ctx, "member", "write") // this path can write (record_work_progress etc), unlike the read-only codeReference path below
    if (roleErr) return roleErr
    try {
      const result = await runSubmission({
        orgId: ctx.orgId,
        userId: actorId,
        mode: typeof body.mode === "string" ? body.mode : "Projects",
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        selectedChain: body.selectedChain,
        rawInput: body.rawInput,
      })
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      console.error("v1 projexa assistant pipeline error:", error)
      const message = error instanceof Error ? error.message : "Failed to run submission pipeline"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  // Old codeReference path -- unchanged.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  try {
    const codeReference = String(body.codeReference ?? "")
    if (!ALLOWED_CODE_REFERENCES.includes(codeReference)) {
      return NextResponse.json({ error: `codeReference must be one of: ${ALLOWED_CODE_REFERENCES.join(", ")}` }, { status: 400 })
    }

    const result = await withTenantContext({ orgId: ctx.orgId, userId: actorId }, (db) =>
      dispatchTool(db, ctx.orgId!, actorId, codeReference, { inputs: body.inputs ?? {} })
    )
    return NextResponse.json({ codeReference, result })
  } catch (error) {
    console.error("v1 projexa assistant dispatch error:", error)
    const message = error instanceof Error ? error.message : "Failed to dispatch construction assistant query"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
