// Wave 90 (Comparison CSV 2 gap analysis: LEGAL001/002 unified Matter
// register + LEGAL004 Arbitration & Mediation + LEGAL009 Legal Spend).
// litigation_matters/ip_portfolio/legal_opinions (Wave 29, pre-dating this
// codebase's service-layer convention) each lived in their own table with
// no cross-cutting concept. This service adds legal_matters as that
// register, linkMatterEntity() to attach an existing litigation/IP/opinion
// row to a matter, arbitration case tracking, and matter-scoped spend.
import {
  legalMatters, legalArbitrationCases, legalSpendEntries,
  litigationMatters, ipPortfolio, legalOpinions, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type LegalContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type MatterInput = { title: string; matterType?: string; description?: string; openedDate: string; responsibleUserId?: string }

export async function listMatters(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.legalMatters.findMany({ where: eq(legalMatters.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function createMatter(ctx: LegalContext, input: MatterInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.openedDate) throw new ServiceError("openedDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${legalMatters.matterNumber}), 0)` })
      .from(legalMatters).where(eq(legalMatters.orgId, ctx.orgId))

    const [matter] = await db.insert(legalMatters).values({
      orgId: ctx.orgId, matterNumber: Number(maxNumber) + 1, title: input.title,
      matterType: input.matterType ?? "general", description: input.description,
      openedDate: input.openedDate, responsibleUserId: input.responsibleUserId, createdById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "legal_matter.created", entityType: "legal_matter", entityId: matter.id })
    return matter
  })
}

export async function closeMatter(ctx: { orgId: string }, matterId: string, closedDate: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Legal matter not found", 404)
    const [updated] = await db.update(legalMatters).set({ status: "closed", closedDate, updatedAt: new Date() }).where(eq(legalMatters.id, matterId)).returning()
    return updated
  })
}

export async function getMatterDetail(ctx: { orgId: string }, matterId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Legal matter not found", 404)

    const [litigation, ip, opinions, arbitrationCases, spendEntries] = await Promise.all([
      db.query.litigationMatters.findMany({ where: eq(litigationMatters.matterId, matterId) }),
      db.query.ipPortfolio.findMany({ where: eq(ipPortfolio.matterId, matterId) }),
      db.query.legalOpinions.findMany({ where: eq(legalOpinions.matterId, matterId) }),
      db.query.legalArbitrationCases.findMany({ where: eq(legalArbitrationCases.matterId, matterId), orderBy: (t, { desc }) => desc(t.createdAt) }),
      db.query.legalSpendEntries.findMany({ where: eq(legalSpendEntries.matterId, matterId), orderBy: (t, { desc }) => desc(t.spendDate) }),
    ])

    const totalSpend = spendEntries.reduce((sum, s) => sum + Number(s.amount), 0)
    return { ...matter, litigation, ip, opinions, arbitrationCases, spendEntries, totalSpend }
  })
}

// Attaches an existing litigation/IP/opinion row (created independently,
// possibly before this matter existed) to the unifying register --
// deliberately a link, never a copy/move of the underlying row.
export async function linkMatterEntity(ctx: { orgId: string }, matterId: string, entityType: "litigation" | "ip" | "opinion", entityId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Legal matter not found", 404)

    if (entityType === "litigation") {
      const row = await db.query.litigationMatters.findFirst({ where: and(eq(litigationMatters.id, entityId), eq(litigationMatters.orgId, ctx.orgId)) })
      if (!row) throw new ServiceError("Litigation matter not found", 404)
      await db.update(litigationMatters).set({ matterId, updatedAt: new Date() }).where(eq(litigationMatters.id, entityId))
    } else if (entityType === "ip") {
      const row = await db.query.ipPortfolio.findFirst({ where: and(eq(ipPortfolio.id, entityId), eq(ipPortfolio.orgId, ctx.orgId)) })
      if (!row) throw new ServiceError("IP portfolio entry not found", 404)
      await db.update(ipPortfolio).set({ matterId, updatedAt: new Date() }).where(eq(ipPortfolio.id, entityId))
    } else {
      const row = await db.query.legalOpinions.findFirst({ where: and(eq(legalOpinions.id, entityId), eq(legalOpinions.orgId, ctx.orgId)) })
      if (!row) throw new ServiceError("Legal opinion not found", 404)
      await db.update(legalOpinions).set({ matterId }).where(eq(legalOpinions.id, entityId))
    }
    return { success: true }
  })
}

export type ArbitrationInput = { caseTitle: string; arbitrationInstitution?: string; arbitrator?: string; filingDate?: string; claimAmount?: number }

export async function createArbitrationCase(ctx: { orgId: string }, matterId: string, input: ArbitrationInput) {
  if (!input.caseTitle?.trim()) throw new ServiceError("caseTitle is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Legal matter not found", 404)
    const [arbitration] = await db.insert(legalArbitrationCases).values({
      matterId, caseTitle: input.caseTitle, arbitrationInstitution: input.arbitrationInstitution,
      arbitrator: input.arbitrator, filingDate: input.filingDate,
      claimAmount: input.claimAmount !== undefined ? String(input.claimAmount) : undefined,
    }).returning()
    return arbitration
  })
}

const VALID_ARBITRATION_TRANSITIONS: Record<string, string[]> = {
  filed: ["ongoing", "closed"],
  ongoing: ["award_passed", "closed"],
  award_passed: ["closed"],
  closed: [],
}

export async function updateArbitrationStatus(ctx: { orgId: string }, arbitrationId: string, status: string, awardDate?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const arbitration = await db.query.legalArbitrationCases.findFirst({ where: eq(legalArbitrationCases.id, arbitrationId) })
    if (!arbitration) throw new ServiceError("Arbitration case not found", 404)
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, arbitration.matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Arbitration case not found", 404)

    const allowed = VALID_ARBITRATION_TRANSITIONS[arbitration.status] ?? []
    if (!allowed.includes(status)) throw new ServiceError(`Cannot transition arbitration case from '${arbitration.status}' to '${status}'`, 409)

    const [updated] = await db.update(legalArbitrationCases).set({
      status, awardDate: status === "award_passed" ? (awardDate ?? new Date().toISOString().slice(0, 10)) : arbitration.awardDate, updatedAt: new Date(),
    }).where(eq(legalArbitrationCases.id, arbitrationId)).returning()
    return updated
  })
}

export type SpendInput = { description: string; category?: string; amount: number; spendDate: string; vendorId?: string }

export async function addSpendEntry(ctx: { orgId: string; userId: string }, matterId: string, input: SpendInput) {
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)
  if (input.amount === undefined || input.amount === null) throw new ServiceError("amount is required", 400)
  if (!input.spendDate) throw new ServiceError("spendDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const matter = await db.query.legalMatters.findFirst({ where: and(eq(legalMatters.id, matterId), eq(legalMatters.orgId, ctx.orgId)) })
    if (!matter) throw new ServiceError("Legal matter not found", 404)
    const [spend] = await db.insert(legalSpendEntries).values({
      matterId, description: input.description, category: input.category ?? "legal_fees",
      amount: String(input.amount), spendDate: input.spendDate, vendorId: input.vendorId, createdById: ctx.userId,
    }).returning()
    return spend
  })
}
