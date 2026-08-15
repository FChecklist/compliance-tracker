// VERIDIAN Review Framework gap-closure: Risk-Based Escalation. Escalation
// ladders exist for AI-operational failures/model-confidence
// (escalation-ladder.ts, CSEO -> COO -> Super Boss -- see
// docs/ESCALATION_MATRIX.md) but nothing escalates a business RISK event
// (a flagged fraud case, a detected anomaly, a newly-logged high-severity
// risk) to a named HUMAN owner. This is a deliberately separate, smaller
// mechanism -- reusing escalation-ladder.ts's AI-role ladder here would be
// wrong by construction (a fraud case needs a real person, not an AI role).
//
// Owner resolution, in order: (1) the actor's own department head
// (departments.head_id -- a real, already-modeled "named human owner"
// concept), (2) the org's most senior admin (veridian_admin, falling back to
// admin), as the accountable fallback when no department context applies or
// no head is set. If neither resolves, the event is recorded but left
// status='open' (unescalated) rather than silently failing -- same
// fail-visible posture as claimEscalation()'s discriminated-union result.
import { riskAnomalyEvents, departments, users, notifications } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, ne } from "drizzle-orm"
import type { AnomalySeverity } from "@/lib/risk-anomaly-detection"

export type RiskAnomalyEventInput = {
  orgId: string
  eventType: string
  severity: AnomalySeverity
  sourceEntityType: string
  sourceEntityId?: string
  actorUserId?: string | null
  reason: string
  detail?: Record<string, unknown>
}

export type ResolvedEscalationOwner = { userId: string; via: "department_head" | "org_admin" }

/**
 * Pure-shaped DB read (no writes) -- resolves who a business risk event for
 * this org/actor should escalate to. Exported separately from
 * recordAndEscalateAnomaly so callers/tests can check resolution logic
 * without needing a full anomaly event to insert.
 */
export async function resolveRiskEscalationOwner(db: TenantDb, orgId: string, actorUserId?: string | null): Promise<ResolvedEscalationOwner | null> {
  if (actorUserId) {
    const actor = await db.query.users.findFirst({ where: eq(users.id, actorUserId) })
    if (actor?.departmentId) {
      const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, actor.departmentId), eq(departments.orgId, orgId)) })
      // Escalating a risky action to its own actor defeats the point of a
      // checks-and-balances escalation (no independent oversight) -- if the
      // actor IS their own department head, fall through to the org-admin
      // fallback below instead of notifying them about themselves.
      if (dept?.headId && dept.headId !== actorUserId) return { userId: dept.headId, via: "department_head" }
    }
  }

  // Two targeted, LIMIT-ed queries instead of fetching every active user in
  // the org just to pick one admin -- veridian_admin (most senior) first,
  // falling back to admin only if no veridian_admin exists. The actor is
  // excluded IN the query itself (not a post-filter) so that if the
  // earliest-created admin happens to be the actor, this correctly falls
  // through to the next-earliest one instead of giving up -- same
  // self-escalation reasoning as the department-head check above.
  const excludeActor = actorUserId ? [ne(users.id, actorUserId)] : []

  const veridianAdmin = await db.query.users.findFirst({
    where: and(eq(users.orgId, orgId), eq(users.isActive, true), eq(users.role, "veridian_admin"), ...excludeActor),
    orderBy: (t, { asc: ordAsc }) => ordAsc(t.createdAt),
  })
  if (veridianAdmin) return { userId: veridianAdmin.id, via: "org_admin" }

  const admin = await db.query.users.findFirst({
    where: and(eq(users.orgId, orgId), eq(users.isActive, true), eq(users.role, "admin"), ...excludeActor),
    orderBy: (t, { asc: ordAsc }) => ordAsc(t.createdAt),
  })
  return admin ? { userId: admin.id, via: "org_admin" } : null
}

/**
 * Inserts a risk_anomaly_events row and, if a named human owner resolves,
 * escalates to them via a notification -- all in the SAME tx the caller's
 * withTenantContext already opened, matching this codebase's established
 * "log + downstream effect commit or roll back together" convention (see
 * audit.ts's logActivity header).
 */
export async function recordAndEscalateAnomaly(db: TenantDb, input: RiskAnomalyEventInput): Promise<{ eventId: string; escalatedTo: string | null }> {
  const [event] = await db.insert(riskAnomalyEvents).values({
    orgId: input.orgId,
    eventType: input.eventType,
    severity: input.severity,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId ?? null,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason,
    detail: input.detail ?? {},
  }).returning()

  const owner = await resolveRiskEscalationOwner(db, input.orgId, input.actorUserId)
  if (!owner) return { eventId: event.id, escalatedTo: null }

  await db.insert(notifications).values({
    userId: owner.userId,
    title: `Risk alert: ${input.eventType.replace(/_/g, " ")}`,
    message: input.reason,
    type: "system",
    metadata: { riskAnomalyEventId: event.id, sourceEntityType: input.sourceEntityType, sourceEntityId: input.sourceEntityId ?? null, severity: input.severity, escalationVia: owner.via },
  })

  await db.update(riskAnomalyEvents).set({ status: "escalated", escalatedToUserId: owner.userId, escalatedAt: new Date() }).where(eq(riskAnomalyEvents.id, event.id))

  return { eventId: event.id, escalatedTo: owner.userId }
}
