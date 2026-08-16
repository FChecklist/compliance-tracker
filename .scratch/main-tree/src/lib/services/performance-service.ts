// Wave 62 (Performance Appraisal, ERP benchmark Tier 3 #14). A review cycle
// is org-wide period master data (e.g. "H1 2026"); a review is one
// employee's record within that cycle -- self rating, manager rating,
// strengths/improvements/goals -- moving through pending -> submitted
// (manager finalizes) -> acknowledged (employee confirms they've read it).
import { performanceReviewCycles, performanceReviews, employeeProfiles, performanceReviewGoals, performanceReviewRaters } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type PerformanceContext = { orgId: string; userId: string }

export async function listReviewCycles(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.performanceReviewCycles.findMany({ where: eq(performanceReviewCycles.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.startDate) })
  )
}

export async function createReviewCycle(ctx: PerformanceContext, input: { name: string; startDate: string; endDate: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.startDate || !input.endDate) throw new ServiceError("startDate and endDate are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(performanceReviewCycles).values({
      orgId: ctx.orgId, name: input.name, startDate: input.startDate, endDate: input.endDate, createdById: ctx.userId,
    }).returning()
    return created
  })
}

export async function activateReviewCycle(ctx: PerformanceContext, cycleId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviewCycles.findFirst({ where: and(eq(performanceReviewCycles.id, cycleId), eq(performanceReviewCycles.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Review cycle not found", 404)
    if (existing.status !== "draft") throw new ServiceError("Only a draft cycle can be activated", 400)
    const [updated] = await db.update(performanceReviewCycles).set({ status: "active" }).where(eq(performanceReviewCycles.id, cycleId)).returning()
    return updated
  })
}

export async function closeReviewCycle(ctx: PerformanceContext, cycleId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviewCycles.findFirst({ where: and(eq(performanceReviewCycles.id, cycleId), eq(performanceReviewCycles.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Review cycle not found", 404)
    if (existing.status !== "active") throw new ServiceError("Only an active cycle can be closed", 400)
    const [updated] = await db.update(performanceReviewCycles).set({ status: "closed" }).where(eq(performanceReviewCycles.id, cycleId)).returning()
    return updated
  })
}

export async function listReviews(ctx: { orgId: string }, filters?: { cycleId?: string; employeeProfileId?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(performanceReviews.orgId, ctx.orgId)]
    if (filters?.cycleId) conditions.push(eq(performanceReviews.cycleId, filters.cycleId))
    if (filters?.employeeProfileId) conditions.push(eq(performanceReviews.employeeProfileId, filters.employeeProfileId))
    return db.query.performanceReviews.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function createReview(
  ctx: PerformanceContext,
  input: { cycleId: string; employeeProfileId: string; reviewerId: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const cycle = await db.query.performanceReviewCycles.findFirst({ where: and(eq(performanceReviewCycles.id, input.cycleId), eq(performanceReviewCycles.orgId, ctx.orgId)) })
    if (!cycle) throw new ServiceError("Review cycle not found", 404)
    const profile = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, input.employeeProfileId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!profile) throw new ServiceError("Employee profile not found", 404)

    const [created] = await db.insert(performanceReviews).values({
      orgId: ctx.orgId, cycleId: input.cycleId, employeeProfileId: input.employeeProfileId, reviewerId: input.reviewerId,
    }).returning()
    return created
  })
}

export async function updateReviewDraft(
  ctx: PerformanceContext,
  reviewId: string,
  input: { selfRating?: number; managerRating?: number; strengths?: string; improvements?: string; goalsForNextPeriod?: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviews.findFirst({ where: and(eq(performanceReviews.id, reviewId), eq(performanceReviews.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Review not found", 404)
    if (existing.status !== "pending") throw new ServiceError("Only a pending review can be edited", 400)

    const [updated] = await db.update(performanceReviews).set({
      selfRating: input.selfRating ?? existing.selfRating,
      managerRating: input.managerRating ?? existing.managerRating,
      strengths: input.strengths ?? existing.strengths,
      improvements: input.improvements ?? existing.improvements,
      goalsForNextPeriod: input.goalsForNextPeriod ?? existing.goalsForNextPeriod,
      updatedAt: new Date(),
    }).where(eq(performanceReviews.id, reviewId)).returning()
    return updated
  })
}

export async function submitReview(ctx: PerformanceContext, reviewId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviews.findFirst({ where: and(eq(performanceReviews.id, reviewId), eq(performanceReviews.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Review not found", 404)
    if (existing.status !== "pending") throw new ServiceError("Review has already been submitted", 400)
    if (existing.managerRating == null) throw new ServiceError("A manager rating is required before submitting", 400)

    // Phase 0 HR gap-closure (2026-07-27): if this review has KRA/weighted
    // goals recorded, compute a weightedScore alongside the unchanged self/
    // managerRating pair. A review with zero goals keeps the original
    // behavior exactly (weightedScore stays null) -- goals are opt-in,
    // never required to submit a review.
    const goals = await db.query.performanceReviewGoals.findMany({ where: eq(performanceReviewGoals.reviewId, reviewId) })
    const weightedScore = goals.length > 0 ? computeWeightedScore(goals) : null

    const [updated] = await db.update(performanceReviews).set({
      status: "submitted", submittedAt: new Date(), updatedAt: new Date(),
      weightedScore: weightedScore != null ? weightedScore.toString() : null,
    }).where(eq(performanceReviews.id, reviewId)).returning()
    return updated
  })
}

// ─── KRA / Weighted Goals (Phase 0 HR gap-closure, 2026-07-27) ───────────

/**
 * Pure helper (no DB access -- exported so it can be unit-tested directly,
 * matching this codebase's established convention): weightPercent across
 * all of a review's goals must sum to exactly 100 and every goal must have
 * a rating before a weighted score can be computed -- both enforced here,
 * not at the DB level, matching this schema's own "business rule in the
 * service layer" convention (see schema.ts's comment on
 * performanceReviewGoals).
 */
export function computeWeightedScore(goals: { rating: number | null; weightPercent: number | string }[]): number {
  const totalWeight = goals.reduce((sum, g) => sum + Number(g.weightPercent), 0)
  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new ServiceError(`Goal weights must sum to 100 (currently ${totalWeight})`, 400)
  }
  if (goals.some((g) => g.rating == null)) {
    throw new ServiceError("Every goal must be rated before computing a weighted score", 400)
  }
  const score = goals.reduce((sum, g) => sum + (g.rating as number) * Number(g.weightPercent), 0) / 100
  return Math.round(score * 100) / 100
}

export async function listReviewGoals(ctx: { orgId: string }, reviewId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.performanceReviewGoals.findMany({ where: and(eq(performanceReviewGoals.orgId, ctx.orgId), eq(performanceReviewGoals.reviewId, reviewId)), orderBy: (t, { asc }) => asc(t.createdAt) })
  )
}

export async function addReviewGoal(ctx: PerformanceContext, reviewId: string, input: { title: string; weightPercent: number }) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.weightPercent || input.weightPercent <= 0 || input.weightPercent > 100) throw new ServiceError("weightPercent must be between 0 and 100", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const review = await db.query.performanceReviews.findFirst({ where: and(eq(performanceReviews.id, reviewId), eq(performanceReviews.orgId, ctx.orgId)) })
    if (!review) throw new ServiceError("Review not found", 404)
    if (review.status !== "pending") throw new ServiceError("Goals can only be added to a pending review", 400)
    const [created] = await db.insert(performanceReviewGoals).values({
      orgId: ctx.orgId, reviewId, title: input.title, weightPercent: input.weightPercent.toString(),
    }).returning()
    return created
  })
}

export async function rateReviewGoal(ctx: PerformanceContext, goalId: string, input: { rating: number; comments?: string }) {
  if (input.rating < 1 || input.rating > 5) throw new ServiceError("rating must be between 1 and 5", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviewGoals.findFirst({ where: and(eq(performanceReviewGoals.id, goalId), eq(performanceReviewGoals.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Goal not found", 404)
    const [updated] = await db.update(performanceReviewGoals).set({
      rating: input.rating, comments: input.comments ?? existing.comments, status: "rated", updatedAt: new Date(),
    }).where(eq(performanceReviewGoals.id, goalId)).returning()
    return updated
  })
}

// ─── Multi-Rater (360) Feedback (Phase 0 HR gap-closure, 2026-07-27) ─────
// Additional raters BEYOND self/manager -- selfRating/managerRating stay
// exactly where they are on performanceReviews itself; this table is
// purely additive 360 coverage.

export async function listReviewRaters(ctx: { orgId: string }, reviewId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.performanceReviewRaters.findMany({ where: and(eq(performanceReviewRaters.orgId, ctx.orgId), eq(performanceReviewRaters.reviewId, reviewId)), orderBy: (t, { asc }) => asc(t.createdAt) })
  )
}

export async function inviteReviewRater(ctx: PerformanceContext, reviewId: string, input: { raterId: string; raterRole: "peer" | "subordinate" | "other" }) {
  if (!input.raterId) throw new ServiceError("raterId is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const review = await db.query.performanceReviews.findFirst({ where: and(eq(performanceReviews.id, reviewId), eq(performanceReviews.orgId, ctx.orgId)) })
    if (!review) throw new ServiceError("Review not found", 404)
    const [created] = await db.insert(performanceReviewRaters).values({
      orgId: ctx.orgId, reviewId, raterId: input.raterId, raterRole: input.raterRole,
    }).returning()
    return created
  })
}

// The invited rater (not the reviewer/manager) submits their own feedback
// -- callers must check the caller's identity matches raterId at the route
// layer, since this service is auth-agnostic (matching acknowledgeReview's
// own established split).
export async function submitRaterFeedback(ctx: PerformanceContext, raterId: string, input: { rating: number; feedback?: string }) {
  if (input.rating < 1 || input.rating > 5) throw new ServiceError("rating must be between 1 and 5", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviewRaters.findFirst({ where: and(eq(performanceReviewRaters.id, raterId), eq(performanceReviewRaters.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Rater invitation not found", 404)
    if (existing.status !== "pending") throw new ServiceError("This rater has already submitted feedback", 400)
    const [updated] = await db.update(performanceReviewRaters).set({
      rating: input.rating, feedback: input.feedback, status: "submitted", submittedAt: new Date(),
    }).where(eq(performanceReviewRaters.id, raterId)).returning()
    return updated
  })
}

// The reviewed employee (not the reviewer) confirms they've read it --
// callers must check the employeeProfile's own userId matches the caller
// at the route layer, since this service is auth-agnostic.
export async function acknowledgeReview(ctx: PerformanceContext, reviewId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.performanceReviews.findFirst({ where: and(eq(performanceReviews.id, reviewId), eq(performanceReviews.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Review not found", 404)
    if (existing.status !== "submitted") throw new ServiceError("Only a submitted review can be acknowledged", 400)

    const [updated] = await db.update(performanceReviews).set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() }).where(eq(performanceReviews.id, reviewId)).returning()
    return updated
  })
}
