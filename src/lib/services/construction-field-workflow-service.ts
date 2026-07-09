// Wave 141 (PROJEXA gap analysis): RFIs, Submittals, and Punch List items.
// No OSS library exists for any of these (confirmed via research) -- a
// first-party CRUD/status-workflow implementation matching this codebase's
// existing construction module conventions (construction-boq-service.ts
// etc.). Per-project numbering is a simple count+1 (not pms_issues'
// atomic issueSequence column -- these tables don't have one, and
// construction's creation concurrency doesn't need that guarantee).
import {
  constructionRfis, constructionSubmittals, constructionPunchListItems,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, count } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// ---------------- RFIs ----------------

export type RfiInput = { projectId: string; subject: string; question: string; assignedToId?: string; dueDate?: string; ballInCourt?: string }

export async function createRfi(ctx: { orgId: string; userId: string }, input: RfiInput) {
  if (!input.subject?.trim()) throw new ServiceError("subject is required", 400)
  if (!input.question?.trim()) throw new ServiceError("question is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionRfis).where(and(eq(constructionRfis.orgId, ctx.orgId), eq(constructionRfis.projectId, input.projectId)))
    const [row] = await db.insert(constructionRfis).values({
      orgId: ctx.orgId, projectId: input.projectId, number: existing + 1,
      subject: input.subject.trim(), question: input.question.trim(),
      assignedToId: input.assignedToId ?? null, dueDate: input.dueDate ?? null,
      ballInCourt: (input.ballInCourt as typeof constructionRfis.$inferInsert.ballInCourt) ?? "architect",
      raisedById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listRfis(ctx: { orgId: string }, projectId: string, filters: { status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionRfis.orgId, ctx.orgId), eq(constructionRfis.projectId, projectId)]
    if (filters.status) conditions.push(eq(constructionRfis.status, filters.status as typeof constructionRfis.$inferSelect.status))
    return db.query.constructionRfis.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.number) })
  })
}

export async function answerRfi(ctx: { orgId: string; userId: string }, rfiId: string, answer: string) {
  if (!answer?.trim()) throw new ServiceError("answer is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionRfis).set({
      answer: answer.trim(), answeredById: ctx.userId, answeredAt: new Date(), status: "answered", ballInCourt: "contractor",
    }).where(and(eq(constructionRfis.id, rfiId), eq(constructionRfis.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("RFI not found", 404)
    return row
  })
}

export async function closeRfi(ctx: { orgId: string }, rfiId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(constructionRfis).set({ status: "closed" }).where(and(eq(constructionRfis.id, rfiId), eq(constructionRfis.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("RFI not found", 404)
    return row
  })
}

// ---------------- Submittals ----------------

export type SubmittalInput = { projectId: string; title: string; specSection?: string; type?: string; dueDate?: string }

export async function createSubmittal(ctx: { orgId: string; userId: string }, input: SubmittalInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionSubmittals).where(and(eq(constructionSubmittals.orgId, ctx.orgId), eq(constructionSubmittals.projectId, input.projectId)))
    const [row] = await db.insert(constructionSubmittals).values({
      orgId: ctx.orgId, projectId: input.projectId, number: existing + 1,
      title: input.title.trim(), specSection: input.specSection ?? null,
      type: (input.type as typeof constructionSubmittals.$inferInsert.type) ?? "shop_drawing",
      dueDate: input.dueDate ?? null, submittedById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listSubmittals(ctx: { orgId: string }, projectId: string, filters: { status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionSubmittals.orgId, ctx.orgId), eq(constructionSubmittals.projectId, projectId)]
    if (filters.status) conditions.push(eq(constructionSubmittals.status, filters.status as typeof constructionSubmittals.$inferSelect.status))
    return db.query.constructionSubmittals.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.number) })
  })
}

export async function reviewSubmittal(ctx: { orgId: string; userId: string }, submittalId: string, status: string, comments?: string) {
  const VALID = ["approved", "approved_as_noted", "revise_resubmit", "rejected"]
  if (!VALID.includes(status)) throw new ServiceError(`status must be one of: ${VALID.join(", ")}`, 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionSubmittals).set({
      status: status as typeof constructionSubmittals.$inferInsert.status,
      reviewComments: comments ?? null, reviewedById: ctx.userId, reviewedAt: new Date(),
    }).where(and(eq(constructionSubmittals.id, submittalId), eq(constructionSubmittals.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Submittal not found", 404)
    return row
  })
}

// ---------------- Punch List ----------------

export type PunchListItemInput = { projectId: string; description: string; location?: string; trade?: string; priority?: string; assignedToId?: string; dueDate?: string }

export async function createPunchListItem(ctx: { orgId: string; userId: string }, input: PunchListItemInput) {
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionPunchListItems).where(and(eq(constructionPunchListItems.orgId, ctx.orgId), eq(constructionPunchListItems.projectId, input.projectId)))
    const [row] = await db.insert(constructionPunchListItems).values({
      orgId: ctx.orgId, projectId: input.projectId, number: existing + 1,
      description: input.description.trim(), location: input.location ?? null, trade: input.trade ?? null,
      priority: (input.priority as typeof constructionPunchListItems.$inferInsert.priority) ?? "medium",
      assignedToId: input.assignedToId ?? null, dueDate: input.dueDate ?? null, createdById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listPunchListItems(ctx: { orgId: string }, projectId: string, filters: { status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionPunchListItems.orgId, ctx.orgId), eq(constructionPunchListItems.projectId, projectId)]
    if (filters.status) conditions.push(eq(constructionPunchListItems.status, filters.status as typeof constructionPunchListItems.$inferSelect.status))
    return db.query.constructionPunchListItems.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.number) })
  })
}

// Mirrors the mockup's original 3-state punch-list lifecycle: field crew
// marks work done (-> ready_for_review), a separate person verifies before
// it's truly closed -- matching the real-world "don't let the person who
// did the work sign off their own fix" convention this feature exists for.
export async function markPunchListItemReadyForReview(ctx: { orgId: string }, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(constructionPunchListItems).set({ status: "ready_for_review" })
      .where(and(eq(constructionPunchListItems.id, itemId), eq(constructionPunchListItems.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Punch list item not found", 404)
    return row
  })
}

export async function verifyPunchListItemClosed(ctx: { orgId: string; userId: string }, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionPunchListItems).set({
      status: "verified_closed", verifiedById: ctx.userId, verifiedAt: new Date(),
    }).where(and(eq(constructionPunchListItems.id, itemId), eq(constructionPunchListItems.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Punch list item not found", 404)
    return row
  })
}
