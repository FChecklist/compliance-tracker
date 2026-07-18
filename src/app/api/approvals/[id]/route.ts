import { approvalRequests, policies, workerAgents, codeChangeRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"
import { runApprovalDecisionMonitor } from "@/lib/monitors/approval-decision-monitor"
import { isSelfApproval } from "@/lib/services/approval-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

// Only someone with 'admin' rank (the closest real-role equivalent to the
// mockup's "Approve" right) can decide a request -- and the underlying
// state change (e.g. policy.status -> published) only happens HERE, never
// at request time. Extensible to other requestTypes as they're added; the
// switch below is the one place that maps a request type to its effect.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { decision, rejectionReason } = body
    if (decision !== "approve" && decision !== "reject") return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 })

    type Outcome = { kind: "ok"; updated: typeof approvalRequests.$inferSelect } | { kind: "not_found" } | { kind: "forbidden" } | { kind: "self_approval" }

    const outcome: Outcome = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const req_ = await db.query.approvalRequests.findFirst({ where: eq(approvalRequests.id, id) })
      if (!req_ || req_.status !== "pending") return { kind: "not_found" }

      // Separation of Duties: this table's own maker-checker design has
      // always had a distinct requestedById (maker) and approvedById
      // (checker) column, but nothing ever compared them -- an admin-rank
      // user could create their own policy_publish/worker_agent_proposal/
      // code_change_request row and then decide it themselves. Reuses the
      // shared engine's own isSelfApproval() (approval-workflow-
      // service.ts) rather than reimplementing the same equality check.
      if (isSelfApproval(req_.requestedById, dbUser.id)) {
        return { kind: "self_approval" }
      }

      // Worker Agent Governance (Wave 16, VAIOS constitution §4): "only
      // Layer 1 may approve" -- veridian_admin is the stricter, in-app
      // stand-in for that authority, above the blanket 'admin' gate every
      // other approval type uses.
      if (req_.requestType === "worker_agent_proposal" && requireRole(dbUser, "veridian_admin")) {
        return { kind: "forbidden" }
      }

      if (decision === "reject") {
        if (!rejectionReason?.trim()) throw new Error("rejectionReason is required")
        if (req_.requestType === "code_change_request") {
          // Keep the denormalized status field honest -- see this table's
          // schema.ts comment ("mirrors approval_requests.status").
          await db.update(codeChangeRequests).set({ status: "rejected" }).where(eq(codeChangeRequests.id, req_.entityId))
        }
        const [updated] = await db.update(approvalRequests).set({ status: "rejected", approvedById: dbUser.id, rejectionReason: rejectionReason.trim(), resolvedAt: new Date() }).where(eq(approvalRequests.id, id)).returning()
        await logActivity({ tx: db, action: "reject", entityType: "ApprovalRequest", entityId: id, details: `Rejected — ${req_.requestType}: "${req_.description}" (${rejectionReason.trim()})`, orgId, dbUser, request })
        // PLATFORM_STRATEGY.md 29.3 Phase 0: the one real Tier-1 rule-engine
        // monitor this phase wires -- proven on APPROVAL_REJECTED here.
        // Same transaction, never blocks the decision above.
        if (updated?.resolvedAt) {
          await runApprovalDecisionMonitor(db, orgId, dbUser, {
            approvalRequestId: id, requestType: req_.requestType, createdAt: req_.createdAt, resolvedAt: updated.resolvedAt, decision: "reject", decidedByUserId: dbUser.id,
          }, request)
        }
        return { kind: "ok", updated }
      }

      // approve -- apply the real effect for this requestType
      if (req_.requestType === "policy_publish") {
        const [publishedPolicy] = await db.update(policies).set({ status: "published", updatedAt: new Date() }).where(eq(policies.id, req_.entityId)).returning({ category: policies.category, title: policies.title, version: policies.version })
        // GAP-D15-REMAINING-TRIGGERS (Priority 10): "SOP Changed" reuses
        // this exact real publish chokepoint rather than a new table/route
        // -- see audit-event-triggers.ts's module header for why. Only
        // fires for policies rows an admin has tagged category='sop'; every
        // other policy publish (governance/hr/environment/etc.) is
        // unaffected.
        if (publishedPolicy?.category === "sop") {
          await recordAuditTrigger({
            tx: db, event: "sop_changed", entityType: "Policy", entityId: req_.entityId, orgId, dbUser,
            details: `SOP "${publishedPolicy.title}" (${publishedPolicy.version}) published.`, request,
          })
        }
      }
      if (req_.requestType === "worker_agent_proposal") {
        // Approve only moves proposed -> approved -- publish (making the
        // agent actually discoverable/dispatchable) is a deliberately
        // separate, explicit action (PATCH .../publish), matching the
        // constitution's distinct "approve, publish, version" verbs.
        await db.update(workerAgents).set({ lifecycleStatus: "approved", updatedAt: new Date() }).where(eq(workerAgents.id, req_.entityId))
      }
      if (req_.requestType === "code_change_request") {
        // Approving ONLY flips this status flag -- it does not, and by
        // construction cannot, cause any code to change. Implementation
        // remains a human directing a coding session outside this app (see
        // code-change-request-service.ts's header note).
        await db.update(codeChangeRequests).set({ status: "approved" }).where(eq(codeChangeRequests.id, req_.entityId))
      }
      const [updated] = await db.update(approvalRequests).set({ status: "approved", approvedById: dbUser.id, resolvedAt: new Date() }).where(eq(approvalRequests.id, id)).returning()
      await logActivity({ tx: db, action: "approve", entityType: "ApprovalRequest", entityId: id, details: `Approved — ${req_.requestType}: "${req_.description}"`, orgId, dbUser, request })
      // PLATFORM_STRATEGY.md 29.3 Phase 0: the one real Tier-1 rule-engine
      // monitor this phase wires -- proven on APPROVAL_GRANTED here. Same
      // transaction, never blocks the decision above.
      if (updated?.resolvedAt) {
        await runApprovalDecisionMonitor(db, orgId, dbUser, {
          approvalRequestId: id, requestType: req_.requestType, createdAt: req_.createdAt, resolvedAt: updated.resolvedAt, decision: "approve", decidedByUserId: dbUser.id,
        }, request)
      }
      return { kind: "ok", updated }
    })

    if (outcome.kind === "forbidden") return NextResponse.json({ error: "This action requires veridian_admin role or higher" }, { status: 403 })
    if (outcome.kind === "self_approval") return NextResponse.json({ error: "You cannot approve or reject a request you submitted yourself -- an independent approver is required" }, { status: 403 })
    if (outcome.kind === "not_found") return NextResponse.json({ error: "Approval request not found or already resolved" }, { status: 404 })
    return NextResponse.json({ id: outcome.updated.id, status: outcome.updated.status })
  } catch (error) {
    console.error("Approval decision error:", error)
    const message = error instanceof Error ? error.message : "Failed to process decision"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
