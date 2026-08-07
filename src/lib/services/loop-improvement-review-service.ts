// VERIDIAN Review Framework gap closure (Continuous Software Evolution,
// High, 2026-08-07): "Self-improvement loops observe and log but never
// actually improve anything" -- loopImprovements has been write-only since
// Wave 146 (loop-improvement-proposer.ts's own header: "No loop gets a path
// to set [isDeployed] true -- that stays a manual/future-approval-flow
// decision"), and until this wave no UI/API let a human even see an
// individual row -- every existing reader (ai-performance-report-service.ts,
// d1-metrics-tracker-service.ts, report-cadence-service.ts) only aggregates
// counts/deltas across a time window.
//
// This is the review queue: a human can now see a pending proposal (what
// loop found it, before/after state, suggested delta) and record a real
// decision. Deliberately does NOT wire "approved" to any auto-apply
// pipeline -- what a loop_improvements row's targetType actually IS varies
// per loop (a detector keyword gap, an AI Team role's prompt tweak, a
// false-negative-rate snapshot with no single fix at all) and building a
// generic auto-apply engine across all of them is real, separate,
// deferred-Phase-3-shaped work, not this gap's scope. "Approved" here means
// "a human agrees this is worth acting on" -- the decision trail that never
// existed, not automated deployment.
//
// loop_improvements has no orgId column (platform-wide, cross-tenant --
// see schema.ts's own comment on why it has no app_runtime RLS policy at
// all) -- this uses the raw `db` client deliberately, same posture as
// capability-audit-service.ts's proposal reads.
import { db, loopImprovements } from "@/lib/db"
import { eq, isNull, and } from "drizzle-orm"

export class ServiceError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export type ReviewDecision = "approved" | "dismissed"
export type ReviewFilter = "pending" | ReviewDecision | "all"

export async function listLoopImprovements(filter: ReviewFilter = "pending") {
  const where =
    filter === "pending" ? isNull(loopImprovements.reviewDecision)
      : filter === "all" ? undefined
      : eq(loopImprovements.reviewDecision, filter)

  return db.query.loopImprovements.findMany({
    where,
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 200,
  })
}

async function recordDecision(id: string, decision: ReviewDecision, reviewerId: string, notes: string | undefined) {
  const existing = await db.query.loopImprovements.findFirst({ where: eq(loopImprovements.id, id) })
  if (!existing) throw new ServiceError(`No loop improvement found for ${id}`, 404)
  if (existing.reviewDecision) {
    throw new ServiceError(`This proposal was already '${existing.reviewDecision}' -- reset isn't supported, the decision trail is permanent.`, 409)
  }

  await db.update(loopImprovements)
    .set({ reviewDecision: decision, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNotes: notes ?? null })
    .where(and(eq(loopImprovements.id, id), isNull(loopImprovements.reviewDecision))) // re-check in the WHERE too: closes the race between the findFirst above and this write
}

export async function approveLoopImprovement(id: string, reviewerId: string, notes?: string): Promise<void> {
  await recordDecision(id, "approved", reviewerId, notes)
}

export async function dismissLoopImprovement(id: string, reviewerId: string, notes?: string): Promise<void> {
  if (!notes?.trim() || notes.trim().length < 10) {
    throw new ServiceError("A real reason (at least 10 characters) is required to dismiss a proposal -- this becomes the permanent record of why it wasn't acted on.", 400)
  }
  await recordDecision(id, "dismissed", reviewerId, notes.trim())
}
