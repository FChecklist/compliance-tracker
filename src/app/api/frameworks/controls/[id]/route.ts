import { frameworkControls } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { hasVerificationEvidence } from "@/lib/services/risk-register-service"
import { recordAndEscalateAnomaly } from "@/lib/services/risk-escalation-service"
import { evaluateAfterHoursHighImpactAction } from "@/lib/risk-anomaly-detection"

const STATUSES = ["not_started", "in_progress", "implemented", "verified"]
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await context.params
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const existing = await db.query.frameworkControls.findFirst({ where: eq(frameworkControls.id, id) })
    if (!existing) return null
    const idx = STATUSES.indexOf(existing.status)
    const nextStatus = STATUSES[Math.min(idx + 1, STATUSES.length - 1)]

    // A control already at the terminal 'verified' status has nowhere
    // further to advance -- STATUSES.indexOf clamps at the last index, so
    // nextStatus === existing.status here. Treat this as a genuine no-op
    // (matching this route's pre-existing idempotent-repeat-click
    // behavior) rather than re-running the evidence gate/after-hours check
    // added below for a real transition that isn't actually happening.
    if (nextStatus === existing.status) return existing

    // Policy Compliance Verification (VERIDIAN Review Framework gap-
    // closure): the 'verified' claim is the one strong enough to need real
    // evidence, not just a manager's click -- see hasVerificationEvidence's
    // own header comment for the full evidence-chain reasoning.
    if (nextStatus === "verified") {
      const hasEvidence = await hasVerificationEvidence(db, orgId, id)
      if (!hasEvidence) {
        return { blocked: true as const }
      }
    }

    const [updated] = await db.update(frameworkControls).set({ status: nextStatus, updatedAt: new Date() }).where(eq(frameworkControls.id, id)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "FrameworkControl", entityId: id, details: `"${existing.title}" moved to ${nextStatus}`, orgId, dbUser, request })

    if (nextStatus === "verified") {
      const afterHoursVerdict = evaluateAfterHoursHighImpactAction("framework_control.verified", new Date())
      if (afterHoursVerdict.anomaly) {
        await recordAndEscalateAnomaly(db, {
          orgId, eventType: afterHoursVerdict.eventType, severity: afterHoursVerdict.severity,
          sourceEntityType: "framework_control", sourceEntityId: id, actorUserId: dbUser.id,
          reason: afterHoursVerdict.reason, detail: { controlRef: existing.controlRef, title: existing.title },
        })
      }
    }
    return updated
  })
  if (!result) return NextResponse.json({ error: "Control not found" }, { status: 404 })
  if ("blocked" in result) {
    return NextResponse.json({ error: "This control cannot be marked 'verified' yet -- it needs a linked risk with a passed audit-finding retest as evidence, not just a manual status change." }, { status: 409 })
  }
  return NextResponse.json({ id: result.id, status: result.status })
}
