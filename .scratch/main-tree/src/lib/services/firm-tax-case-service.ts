// Wave 108 (THE FIRM AI OS) -- Indian income-tax/GST notice, assessment,
// and appeal procedural workflow. The genuine new domain this wave: the
// generic `notices` table already tracks government notices, but has no
// assessment-year/section-code/appellate-forum/limitation-date structure
// a CA firm's tax practice actually needs day to day. linkedNoticeId
// references the existing notice rather than duplicating it.
import { firmTaxCases, clients, notices } from "@/lib/db"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte, isNotNull } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type FirmTaxCaseInput = {
  clientId: string
  assessmentYear: string
  caseType?: string
  sectionCode?: string | null
  authority?: string | null
  forum?: string
  stage?: string
  dueDate?: string | null
  limitationDate?: string | null
  demandAmount?: number | null
  linkedNoticeId?: string | null
  responsibleUserId?: string | null
}

export async function createTaxCase(ctx: FirmServiceContext, input: FirmTaxCaseInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.assessmentYear?.trim()) throw new ServiceError("assessmentYear is required", 400)

  return withFirmTenantContext(ctx, async (db) => {
    await assertClientBelongsToOrg(db, input.clientId, ctx.orgId)

    if (input.linkedNoticeId) {
      const notice = await db.query.notices.findFirst({ where: and(eq(notices.id, input.linkedNoticeId), eq(notices.orgId, ctx.orgId)) })
      if (!notice) throw new ServiceError("Linked notice not found", 404)
    }

    const [taxCase] = await db.insert(firmTaxCases).values({
      orgId: ctx.orgId,
      clientId: input.clientId,
      assessmentYear: input.assessmentYear.trim(),
      caseType: input.caseType ?? "scrutiny",
      sectionCode: input.sectionCode ?? null,
      authority: input.authority ?? null,
      forum: input.forum ?? "ao",
      stage: input.stage ?? "notice_received",
      dueDate: input.dueDate ?? null,
      limitationDate: input.limitationDate ?? null,
      demandAmount: input.demandAmount != null ? String(input.demandAmount) : null,
      linkedNoticeId: input.linkedNoticeId ?? null,
      responsibleUserId: input.responsibleUserId ?? null,
      createdById: ctx.userId,
    }).returning()

    return taxCase
  })
}

export async function updateTaxCaseStage(ctx: FirmServiceContext, caseId: string, stage: string, outcome?: string | null) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const existing = await db.query.firmTaxCases.findFirst({ where: and(eq(firmTaxCases.id, caseId), eq(firmTaxCases.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Tax case not found", 404)

    const [updated] = await db.update(firmTaxCases).set({
      stage,
      outcome: outcome !== undefined ? outcome : existing.outcome,
      updatedAt: new Date(),
    }).where(eq(firmTaxCases.id, caseId)).returning()

    return updated
  })
}

export async function listTaxCasesForClient(ctx: FirmServiceContext, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    return db.query.firmTaxCases.findMany({
      where: and(eq(firmTaxCases.clientId, clientId), eq(firmTaxCases.orgId, ctx.orgId)),
      orderBy: (t, { asc }) => asc(t.limitationDate),
    })
  })
}

export async function listUpcomingLimitationDates(ctx: FirmServiceContext, withinDays: number) {
  await requireFirmEnabled(ctx.orgId)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + withinDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  return withFirmTenantContext(ctx, async (db) => {
    return db.query.firmTaxCases.findMany({
      where: and(eq(firmTaxCases.orgId, ctx.orgId), isNotNull(firmTaxCases.limitationDate), lte(firmTaxCases.limitationDate, cutoffStr)),
      orderBy: (t, { asc }) => asc(t.limitationDate),
    })
  })
}
