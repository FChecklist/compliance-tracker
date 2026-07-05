// Wave 97 (Comparison CSV 3 gap analysis: IAM010 "Access Review"). A real
// periodic access-certification cycle over the existing RBAC assignments
// (users.role) -- opening a cycle snapshots every active user's current
// role into a pending certification row; an admin then confirms or revokes
// each one. "Revoked" has real teeth: it flips the user's isActive to
// false, which requireAuth() (same wave) now actually enforces.
import { accessReviewCycles, accessReviewCertifications, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type AccessReviewContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function createAccessReviewCycle(ctx: AccessReviewContext, input: { name: string; dueDate?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const activeUsers = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.isActive, true)) })
    if (activeUsers.length === 0) throw new ServiceError("No active users to review in this organisation", 400)

    const [cycle] = await db.insert(accessReviewCycles).values({
      orgId: ctx.orgId, name: input.name, dueDate: input.dueDate, createdById: ctx.userId,
    }).returning()

    await db.insert(accessReviewCertifications).values(
      activeUsers.map((u) => ({ cycleId: cycle.id, orgId: ctx.orgId, userId: u.id, reviewedRole: u.role }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "access_review.cycle_created", entityType: "access_review_cycle", entityId: cycle.id, details: JSON.stringify({ userCount: activeUsers.length }) })
    return cycle
  })
}

export async function listAccessReviewCycles(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.accessReviewCycles.findMany({ where: eq(accessReviewCycles.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function getAccessReviewCycleDetail(ctx: { orgId: string }, cycleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const cycle = await db.query.accessReviewCycles.findFirst({ where: and(eq(accessReviewCycles.id, cycleId), eq(accessReviewCycles.orgId, ctx.orgId)) })
    if (!cycle) throw new ServiceError("Access review cycle not found", 404)

    const certifications = await db.query.accessReviewCertifications.findMany({
      where: eq(accessReviewCertifications.cycleId, cycleId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    })
    const userIds = certifications.map((c) => c.userId)
    const certUsers = userIds.length > 0 ? await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), inArray(users.id, userIds)) }) : []
    const userById = new Map(certUsers.map((u) => [u.id, u]))

    return {
      ...cycle,
      certifications: certifications.map((c) => ({
        ...c,
        userName: userById.get(c.userId)?.name ?? "Unknown user",
        userEmail: userById.get(c.userId)?.email ?? null,
      })),
    }
  })
}

export async function reviewCertification(ctx: AccessReviewContext, certificationId: string, decision: "confirmed" | "revoked") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const cert = await db.query.accessReviewCertifications.findFirst({ where: and(eq(accessReviewCertifications.id, certificationId), eq(accessReviewCertifications.orgId, ctx.orgId)) })
    if (!cert) throw new ServiceError("Certification not found", 404)
    if (cert.decision !== "pending") throw new ServiceError(`This certification has already been decided ('${cert.decision}')`, 409)

    const [updated] = await db.update(accessReviewCertifications).set({
      decision, reviewedById: ctx.userId, reviewedAt: new Date(),
    }).where(eq(accessReviewCertifications.id, certificationId)).returning()

    if (decision === "revoked") {
      await db.update(users).set({ isActive: false }).where(eq(users.id, cert.userId))
    }

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "access_review.certification_decided", entityType: "access_review_certification", entityId: certificationId, details: JSON.stringify({ decision, subjectUserId: cert.userId }) })

    // Auto-close the cycle once every certification has a real decision.
    const remainingPending = await db.query.accessReviewCertifications.findFirst({
      where: and(eq(accessReviewCertifications.cycleId, cert.cycleId), eq(accessReviewCertifications.decision, "pending")),
    })
    if (!remainingPending) {
      await db.update(accessReviewCycles).set({ status: "completed", completedAt: new Date() }).where(eq(accessReviewCycles.id, cert.cycleId))
    }

    return updated
  })
}
