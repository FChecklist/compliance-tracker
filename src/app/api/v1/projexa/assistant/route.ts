// Wave 129: structured "ask a construction question" surface for PROJEXA.
// Calls task-execution-engine.ts's dispatchTool() directly with an explicit
// codeReference -- the same deterministic dispatch mechanism VeriComposer's
// Mode Pills + Chain Selector uses (see capability-tree-service.ts's
// buildConstructionNodes(), Wave 128), just reached via REST instead of a
// tree click. Deliberately scoped to ONLY the 7 construction codeReferences
// registered in Wave 128 -- this endpoint is not a general dispatchTool()
// proxy for every worker agent on the platform (compliance/GST/etc stay
// reachable only through their own surfaces).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { dispatchTool } from "@/lib/task-execution-engine"

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
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const codeReference = String(body.codeReference ?? "")
    if (!ALLOWED_CODE_REFERENCES.includes(codeReference)) {
      return NextResponse.json({ error: `codeReference must be one of: ${ALLOWED_CODE_REFERENCES.join(", ")}` }, { status: 400 })
    }
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

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
