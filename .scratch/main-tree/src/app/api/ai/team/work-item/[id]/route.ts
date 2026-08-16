import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, auditProtocolFindings } from "@/lib/db"

// GAP-UNIFIED-SOT-REMAINDER slice (d): a real, DB/API-queryable surface for
// "what do we know about this work item" -- so any agent (Claude, GLM-5.2,
// a future agent) can hit one endpoint rather than knowing
// audit_protocol_findings' schema and hand-writing SQL. veridian_admin-
// gated, same posture as /api/ai/team/governance-health -- platform-
// internal governance, not a customer workflow.
//
// Honest scope note, verified by direct grep (not assumed) before writing
// this route: today there is NO real correlation key between an
// audit_protocol_findings row (keyed by PR number/branch name) and any
// task_agent_executions or activity_log row (keyed by
// taskExecutionPlanId/activity id respectively). src/lib/ai-team/
// dispatch-repo.ts and roster.ts store neither a PR number nor a branch
// name anywhere -- confirmed by grepping both files for "branch", zero
// matches. handover-protocol.ts's own header independently documents that
// task_agent_executions was built as "a parallel mechanism," deliberately
// not unified with activityLog. So a real 3-way join
// (audit finding <-> execution <-> activity) is NOT possible with today's
// schema, and this route does not fabricate one. `id` is the one thing
// that genuinely IS joinable -- a PR number -- and the response returns the
// audit_protocol_findings row(s) for that PR plus an explicit
// `correlation` block stating the above, so a caller sees the real
// boundary instead of an empty/misleading result.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Work-item lookup is veridian_admin-only" }, { status: 403 })
  }

  const { id } = await context.params
  const prNumber = Number(id)
  if (!Number.isFinite(prNumber)) {
    return NextResponse.json(
      {
        error:
          "id must be a numeric PR number -- the only real correlation key audit_protocol_findings currently supports (see this route's own header comment for why).",
      },
      { status: 400 }
    )
  }

  const findings = await db.query.auditProtocolFindings.findMany({
    where: eq(auditProtocolFindings.prNumber, prNumber),
    orderBy: desc(auditProtocolFindings.submittedAt),
  })

  return NextResponse.json({
    id,
    prNumber,
    auditFindings: findings,
    // Deliberately null, not omitted -- makes the absence of a real join
    // visible to any caller/agent rather than silently looking like "no
    // executions happened," which would be a different, false claim.
    correlation: {
      taskAgentExecutions: null,
      activityLog: null,
      note:
        "No real correlation key exists yet between audit_protocol_findings (keyed by PR number/branch name) and task_agent_executions/activity_log (keyed by taskExecutionPlanId/activity id) -- verified by grepping src/lib/ai-team/dispatch-repo.ts and roster.ts for a stored branch name or PR number (zero matches) before this route was written. Extend this route once a real key exists rather than joining on a guess.",
    },
  })
}
