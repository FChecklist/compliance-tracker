import { boardEvaluations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const STAGES = ["initiated", "questionnaires_circulated", "responses_collected", "report_drafted", "board_discussion", "closed"]

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ evaluations: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.boardEvaluations.findMany({ orderBy: desc(boardEvaluations.createdAt) }))
  return NextResponse.json({
    evaluations: rows.map((e) => ({ id: e.id, cycle: e.cycle, currentStage: e.currentStage, scope: e.scope, respondents: e.respondents, actionItems: e.actionItems, history: e.history })),
    stages: STAGES,
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.cycle?.trim()) return NextResponse.json({ error: "cycle is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [evaluation] = await db.insert(boardEvaluations).values({
      cycle: body.cycle.trim(), scope: Array.isArray(body.scope) ? body.scope : [], respondents: Array.isArray(body.respondents) ? body.respondents : [], orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "BoardEvaluation", entityId: evaluation.id, details: `Evaluation cycle initiated: ${evaluation.cycle}`, orgId, dbUser, request })
    return evaluation
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
