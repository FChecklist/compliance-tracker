import { boardEvaluations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const STAGES = ["initiated", "questionnaires_circulated", "responses_collected", "report_drafted", "board_discussion", "closed"]

type RouteContext = { params: Promise<{ id: string }> }

// Advances to the next stage; on reaching 'closed', archives the outcome
// into history (never overwrites -- same append-only principle used
// throughout this app).
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.boardEvaluations.findFirst({ where: eq(boardEvaluations.id, id) })
      if (!existing) return null

      const idx = STAGES.indexOf(existing.currentStage)
      if (idx >= STAGES.length - 1) return existing
      const nextStage = STAGES[idx + 1]

      const history = Array.isArray(existing.history) ? existing.history : []
      const newHistory = nextStage === "closed"
        ? [{ cycle: existing.cycle, completedDate: new Date().toISOString(), outcome: "Closed — see action items for follow-up" }, ...history]
        : history

      const [updated] = await db.update(boardEvaluations).set({ currentStage: nextStage, history: newHistory, updatedAt: new Date() }).where(eq(boardEvaluations.id, id)).returning()
      await logActivity({ tx: db, action: "status_change", entityType: "BoardEvaluation", entityId: id, details: `"${existing.cycle}" moved to ${nextStage}`, orgId, dbUser, request })
      return updated
    })

    if (!result) return NextResponse.json({ error: "Evaluation not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, currentStage: result.currentStage })
  } catch (error) {
    console.error("Board evaluation PATCH error:", error)
    return NextResponse.json({ error: "Failed to update evaluation" }, { status: 500 })
  }
}
