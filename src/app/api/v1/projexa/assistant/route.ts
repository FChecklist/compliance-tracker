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
import { resolveFinancialRole } from "@/lib/supabase/acting-role"
import { assertKeyProjectScope, keyProjectScope } from "@/lib/supabase/api-key-auth"
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

// PROJEXA-BUILD-001 U-01 (2026-09-25): both paths below used to pass
// `ctx.dbUser?.role ?? null`, and requireAuthOrApiKey() returns dbUser: null
// for an API-key caller -- which is how PROJEXA's own assistant calls this
// route (one per-org key) -- so the role was always null, and a null role
// used to mean "show the figures" to every PROJEXA user of every rank. The
// role now comes from resolveFinancialRole() (lib/supabase/acting-role.ts,
// moved there in U-01b so tasks/ and submissions/ share it). U-01d: it
// returns a role or null and never an error, so a named person with no linked
// VERIDIAN user gets redacted figures here, not the 400 U-01 gave them.

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
    // PROJEXA-BUILD-001 U-19 (BR-213): same rule as submissions/route.ts -- a
    // project_ai key on another project is a 403 before anything is written.
    const projectId = typeof body.projectId === "string" ? body.projectId : null
    const keyScope = assertKeyProjectScope(ctx.apiKey, projectId)
    if (!keyScope.ok) return NextResponse.json({ error: keyScope.message }, { status: keyScope.status })
    try {
      const financialRole = await resolveFinancialRole(ctx, request, body)
      const result = await runSubmission({
        orgId: ctx.orgId,
        userId: actorId,
        mode: typeof body.mode === "string" ? body.mode : "Projects",
        projectId,
        selectedChain: body.selectedChain,
        rawInput: body.rawInput,
        role: financialRole,
        projectScope: keyProjectScope(ctx.apiKey),
      })
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      console.error("v1 projexa assistant pipeline error:", error)
      const message = error instanceof Error ? error.message : "Failed to run submission pipeline"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  // Old codeReference path -- unchanged apart from U-01's role (resolveFinancialRole, acting-role.ts).
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  try {
    const codeReference = String(body.codeReference ?? "")
    if (!ALLOWED_CODE_REFERENCES.includes(codeReference)) {
      return NextResponse.json({ error: `codeReference must be one of: ${ALLOWED_CODE_REFERENCES.join(", ")}` }, { status: 400 })
    }

    const financialRole = await resolveFinancialRole(ctx, request, body)

    const result = await withTenantContext({ orgId: ctx.orgId, userId: actorId }, (db) =>
      dispatchTool(db, ctx.orgId!, actorId, codeReference, { inputs: body.inputs ?? {} }, financialRole)
    )
    return NextResponse.json({ codeReference, result })
  } catch (error) {
    console.error("v1 projexa assistant dispatch error:", error)
    const message = error instanceof Error ? error.message : "Failed to dispatch construction assistant query"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
