// Wave 92 (Comparison CSV 3 gap analysis: GRC012 "Fraud Management").
// Zero fraud-detection/case-tracking capability existed anywhere in the
// codebase before this wave -- confirmed via a dedicated codebase-survey
// pass. This is a real case register with a status machine, not a
// detection-algorithm claim -- VERIDIAN has no transaction-monitoring feed
// to run anomaly detection against; this tracks cases however they're
// first identified (audit, whistleblower, system alert, external report).
import { fraudCases, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type FraudContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Priority 15 (PROJEXA GRC alias): same dbUser-or-apiKey actor union as
// erp-invoicing-service.ts's createSalesInvoice (Priority 13) -- PROJEXA's
// Bearer-key caller never carries a session dbUser, so gating fraud-case
// creation on FraudContext's strict dbUser would make it permanently
// unreachable from PROJEXA rather than just "deferred".
export type FraudActorCtx = { orgId: string; userId: string } & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } })

export type FraudCaseInput = {
  title: string
  fraudType?: string
  detectionSource?: string
  description?: string
  financialExposure?: number
  reportedDate: string
  investigatorId?: string
  linkedRiskId?: string
}

export async function listFraudCases(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.fraudCases.findMany({ where: eq(fraudCases.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function getFraudCase(ctx: { orgId: string }, caseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const fraudCase = await db.query.fraudCases.findFirst({ where: and(eq(fraudCases.id, caseId), eq(fraudCases.orgId, ctx.orgId)) })
    if (!fraudCase) throw new ServiceError("Fraud case not found", 404)
    return fraudCase
  })
}

export async function createFraudCase(ctx: FraudActorCtx, input: FraudCaseInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.reportedDate) throw new ServiceError("reportedDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${fraudCases.caseNumber}), 0)` })
      .from(fraudCases).where(eq(fraudCases.orgId, ctx.orgId))

    const [fraudCase] = await db.insert(fraudCases).values({
      orgId: ctx.orgId, caseNumber: Number(maxNumber) + 1, title: input.title,
      fraudType: input.fraudType ?? "other", detectionSource: input.detectionSource ?? "other",
      description: input.description, financialExposure: input.financialExposure !== undefined ? String(input.financialExposure) : undefined,
      reportedDate: input.reportedDate, investigatorId: input.investigatorId, linkedRiskId: input.linkedRiskId,
      recordedById: ctx.userId,
    }).returning()

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "fraud_case.created", entityType: "fraud_case", entityId: fraudCase.id }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "fraud_case.created", entityType: "fraud_case", entityId: fraudCase.id }
    )
    return fraudCase
  })
}

const VALID_FRAUD_TRANSITIONS: Record<string, string[]> = {
  reported: ["investigating"],
  investigating: ["confirmed", "unsubstantiated"],
  confirmed: ["resolved"],
  unsubstantiated: ["resolved"],
  resolved: [],
}

export async function updateFraudCaseStatus(ctx: FraudActorCtx, caseId: string, status: string, resolutionSummary?: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const fraudCase = await db.query.fraudCases.findFirst({ where: and(eq(fraudCases.id, caseId), eq(fraudCases.orgId, ctx.orgId)) })
    if (!fraudCase) throw new ServiceError("Fraud case not found", 404)

    const allowed = VALID_FRAUD_TRANSITIONS[fraudCase.status] ?? []
    if (!allowed.includes(status)) throw new ServiceError(`Cannot transition fraud case from '${fraudCase.status}' to '${status}'`, 409)

    const [updated] = await db.update(fraudCases).set({
      status, resolutionSummary: status === "resolved" ? (resolutionSummary ?? fraudCase.resolutionSummary) : fraudCase.resolutionSummary,
      resolvedDate: status === "resolved" ? new Date().toISOString().slice(0, 10) : fraudCase.resolvedDate,
      updatedAt: new Date(),
    }).where(eq(fraudCases.id, caseId)).returning()

    await logActivity(
      ctx.dbUser
        ? { tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "fraud_case.status_changed", entityType: "fraud_case", entityId: caseId, details: JSON.stringify({ from: fraudCase.status, to: status }) }
        : { tx: db, orgId: ctx.orgId, apiKey: ctx.apiKey, action: "fraud_case.status_changed", entityType: "fraud_case", entityId: caseId, details: JSON.stringify({ from: fraudCase.status, to: status }) }
    )
    return updated
  })
}
