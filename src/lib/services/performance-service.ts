// Wave 62 (Performance Appraisal, ERP benchmark Tier 3 #14). A review cycle
// is org-wide period master data (e.g. "H1 2026"); a review is one
// employee's record within that cycle -- self rating, manager rating,
// strengths/improvements/goals -- moving through pending -> submitted
// (manager finalizes) -> acknowledged (employee confirms they've read it).
import { performanceReviewCycles, performanceReviews, employeeProfiles } from "@/lib/db"
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

    const [updated] = await db.update(performanceReviews).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(performanceReviews.id, reviewId)).returning()
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
