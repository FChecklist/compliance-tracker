// R65 gap-closure (report_definitions data_gap cluster, 8 reports: Tender
// Register/Pipeline/Win-Loss/Costing, BOQ Submission, Pre-Bid Meeting, EMD
// Tracking, Contract Award). See schema.ts's own comment above
// constructionTenders for why this is a genuinely new entity, distinct from
// erp_rfqs (procurement) -- a tender is this org bidding to win a client
// contract, not this org buying from suppliers.
//
// CRUD + the specific read-side aggregations each report needs, following
// this codebase's convention of query-time rollups over denormalized
// summary columns (matches construction-boq-service.ts/kpi-hub-service.ts).
import {
  constructionTenders, constructionTenderBoqItems, constructionTenderPreBidMeetings,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, desc } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TenderContext = { orgId: string; userId: string }

export type TenderInput = {
  projectId?: string | null
  tenderNumber: string
  issuingAuthority: string
  title: string
  estimatedValue?: number
  emdAmount?: number
  submissionDeadline?: string | null
}

export type TenderBoqItemInput = {
  itemCode?: string
  description: string
  unit: string
  quantity: number
  rate: number
}

export function computeTenderBoqItemAmount(quantity: number, rate: number) {
  return Math.round(quantity * rate * 100) / 100
}

export async function listTenders(ctx: { orgId: string }, filters?: { stage?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionTenders.findMany({
      where: filters?.stage
        ? and(eq(constructionTenders.orgId, ctx.orgId), eq(constructionTenders.stage, filters.stage as any))
        : eq(constructionTenders.orgId, ctx.orgId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
  )
}

export async function getTender(ctx: { orgId: string }, tenderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const tender = await db.query.constructionTenders.findFirst({
      where: and(eq(constructionTenders.id, tenderId), eq(constructionTenders.orgId, ctx.orgId)),
    })
    if (!tender) throw new ServiceError("Tender not found", 404)
    const boqItems = await db.query.constructionTenderBoqItems.findMany({
      where: eq(constructionTenderBoqItems.tenderId, tenderId),
    })
    const preBidMeetings = await db.query.constructionTenderPreBidMeetings.findMany({
      where: eq(constructionTenderPreBidMeetings.tenderId, tenderId),
      orderBy: (t, { desc }) => [desc(t.meetingDate)],
    })
    return { ...tender, boqItems, preBidMeetings }
  })
}

export async function createTender(ctx: TenderContext, input: TenderInput) {
  const tenderNumber = input.tenderNumber?.trim()
  const issuingAuthority = input.issuingAuthority?.trim()
  const title = input.title?.trim()
  if (!tenderNumber) throw new ServiceError("tenderNumber is required", 400)
  if (!issuingAuthority) throw new ServiceError("issuingAuthority is required", 400)
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [tender] = await db.insert(constructionTenders).values({
      orgId: ctx.orgId,
      projectId: input.projectId ?? null,
      tenderNumber,
      issuingAuthority,
      title,
      estimatedValue: String(input.estimatedValue ?? 0),
      emdAmount: String(input.emdAmount ?? 0),
      submissionDeadline: input.submissionDeadline ?? null,
      createdById: ctx.userId,
    }).returning()
    return tender
  })
}

// Stage transitions are a small explicit state machine, not a free-form
// enum write -- matches crm-service.ts's isValidStageTransition()/
// updateOpportunity() stage-transition-legality precedent (R63 Sales
// Pipeline gap-closure). Pure + exported so it's unit-testable without a
// DB mock, same discipline as that precedent.
const VALID_TENDER_TRANSITIONS: Record<string, string[]> = {
  identified: ["pre_bid", "lost"],
  pre_bid: ["costing", "lost"],
  costing: ["submitted", "lost"],
  submitted: ["won", "lost"],
  won: ["awarded"],
  lost: [],
  awarded: [],
}

export function isValidTenderStageTransition(fromStage: string, toStage: string): boolean {
  return (VALID_TENDER_TRANSITIONS[fromStage] ?? []).includes(toStage)
}

export async function updateTenderStage(
  ctx: TenderContext,
  tenderId: string,
  newStage: string,
  extra?: { lossReason?: string; contractAwardSalesOrderId?: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const tender = await db.query.constructionTenders.findFirst({
      where: and(eq(constructionTenders.id, tenderId), eq(constructionTenders.orgId, ctx.orgId)),
    })
    if (!tender) throw new ServiceError("Tender not found", 404)
    if (!isValidTenderStageTransition(tender.stage, newStage)) {
      throw new ServiceError(`Cannot transition tender from '${tender.stage}' to '${newStage}'`, 400)
    }
    if (newStage === "lost" && !extra?.lossReason) {
      throw new ServiceError("lossReason is required when marking a tender lost", 400)
    }
    if (newStage === "awarded" && !extra?.contractAwardSalesOrderId) {
      throw new ServiceError("contractAwardSalesOrderId is required when marking a tender awarded", 400)
    }
    const [updated] = await db.update(constructionTenders).set({
      stage: newStage as any,
      lossReason: newStage === "lost" ? extra?.lossReason : tender.lossReason,
      wonAt: newStage === "won" ? new Date() : tender.wonAt,
      contractAwardSalesOrderId: newStage === "awarded" ? extra?.contractAwardSalesOrderId : tender.contractAwardSalesOrderId,
      updatedAt: new Date(),
    }).where(eq(constructionTenders.id, tenderId)).returning()
    return updated
  })
}

export async function recordEmdStatus(ctx: TenderContext, tenderId: string, emdStatus: "not_paid" | "paid" | "refunded" | "forfeited") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const tender = await db.query.constructionTenders.findFirst({
      where: and(eq(constructionTenders.id, tenderId), eq(constructionTenders.orgId, ctx.orgId)),
    })
    if (!tender) throw new ServiceError("Tender not found", 404)
    const [updated] = await db.update(constructionTenders).set({ emdStatus, updatedAt: new Date() })
      .where(eq(constructionTenders.id, tenderId)).returning()
    return updated
  })
}

export async function addTenderBoqItems(ctx: TenderContext, tenderId: string, items: TenderBoqItemInput[]) {
  if (!items.length) return []
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const tender = await db.query.constructionTenders.findFirst({
      where: and(eq(constructionTenders.id, tenderId), eq(constructionTenders.orgId, ctx.orgId)),
    })
    if (!tender) throw new ServiceError("Tender not found", 404)
    return db.insert(constructionTenderBoqItems).values(
      items.map((it) => ({
        orgId: ctx.orgId,
        tenderId,
        itemCode: it.itemCode,
        description: it.description,
        unit: it.unit,
        quantity: String(it.quantity),
        rate: String(it.rate),
        amount: String(computeTenderBoqItemAmount(it.quantity, it.rate)),
      }))
    ).returning()
  })
}

export async function addPreBidMeeting(
  ctx: TenderContext,
  tenderId: string,
  input: { meetingDate: string; queriesRaised?: string; clarificationsReceived?: string }
) {
  if (!input.meetingDate) throw new ServiceError("meetingDate is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const tender = await db.query.constructionTenders.findFirst({
      where: and(eq(constructionTenders.id, tenderId), eq(constructionTenders.orgId, ctx.orgId)),
    })
    if (!tender) throw new ServiceError("Tender not found", 404)
    const [meeting] = await db.insert(constructionTenderPreBidMeetings).values({
      orgId: ctx.orgId,
      tenderId,
      meetingDate: input.meetingDate,
      queriesRaised: input.queriesRaised,
      clarificationsReceived: input.clarificationsReceived,
      createdById: ctx.userId,
    }).returning()
    return meeting
  })
}

// ---- Report-facing aggregations (consumed by report-engine-service.ts's
// FORMULA_REGISTRY -- see the tender_* formula keys registered there) ----

export async function tenderPipelineByStage(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionTenders.findMany({ where: eq(constructionTenders.orgId, ctx.orgId) })
    const byStage: Record<string, { count: number; totalEstimatedValue: number }> = {}
    for (const t of rows) {
      const bucket = (byStage[t.stage] ??= { count: 0, totalEstimatedValue: 0 })
      bucket.count += 1
      bucket.totalEstimatedValue += Number(t.estimatedValue ?? 0)
    }
    return Object.entries(byStage).map(([stage, v]) => ({
      Stage: stage, Count: v.count, "Total Estimated Value": v.totalEstimatedValue,
    }))
  })
}

export async function tenderWinLossReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionTenders.findMany({
      where: eq(constructionTenders.orgId, ctx.orgId),
    })
    const decided = rows.filter((t) => t.stage === "won" || t.stage === "lost" || t.stage === "awarded")
    const won = decided.filter((t) => t.stage === "won" || t.stage === "awarded")
    const lost = decided.filter((t) => t.stage === "lost")
    return decided.map((t) => ({
      "Tender Number": t.tenderNumber,
      Title: t.title,
      "Issuing Authority": t.issuingAuthority,
      Outcome: t.stage === "lost" ? "Lost" : "Won",
      "Loss Reason": t.lossReason ?? "",
      "Estimated Value": Number(t.estimatedValue ?? 0),
    })).concat(decided.length === 0 ? [] : [{
      "Tender Number": "TOTAL", Title: "", "Issuing Authority": "",
      Outcome: `${won.length} won / ${lost.length} lost`, "Loss Reason": "",
      "Estimated Value": decided.reduce((s, t) => s + Number(t.estimatedValue ?? 0), 0),
    }])
  })
}

export async function tenderCostingReport(ctx: { orgId: string }, tenderId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const tenders = tenderId
      ? await db.query.constructionTenders.findMany({ where: and(eq(constructionTenders.orgId, ctx.orgId), eq(constructionTenders.id, tenderId)) })
      : await db.query.constructionTenders.findMany({ where: eq(constructionTenders.orgId, ctx.orgId) })
    const results: Array<{ "Tender Number": string; Title: string; "Estimated Value": number; "BOQ Cost": number; Margin: number }> = []
    for (const t of tenders) {
      const items = await db.query.constructionTenderBoqItems.findMany({ where: eq(constructionTenderBoqItems.tenderId, t.id) })
      const boqCost = items.reduce((s, i) => s + Number(i.amount ?? 0), 0)
      results.push({
        "Tender Number": t.tenderNumber,
        Title: t.title,
        "Estimated Value": Number(t.estimatedValue ?? 0),
        "BOQ Cost": boqCost,
        Margin: Number(t.estimatedValue ?? 0) - boqCost,
      })
    }
    return results
  })
}

export async function tenderRegisterReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionTenders.findMany({
      where: eq(constructionTenders.orgId, ctx.orgId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
    return rows.map((t) => ({
      "Tender Number": t.tenderNumber,
      Title: t.title,
      "Issuing Authority": t.issuingAuthority,
      Stage: t.stage,
      "Estimated Value": Number(t.estimatedValue ?? 0),
      "Submission Deadline": t.submissionDeadline ?? "",
    }))
  })
}

export async function boqSubmissionReport(ctx: { orgId: string }, tenderId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const tenders = tenderId
      ? await db.query.constructionTenders.findMany({ where: and(eq(constructionTenders.orgId, ctx.orgId), eq(constructionTenders.id, tenderId)) })
      : await db.query.constructionTenders.findMany({ where: eq(constructionTenders.orgId, ctx.orgId) })
    const results: Array<{ "Tender Number": string; "Item Code": string; Description: string; Unit: string; Quantity: number; Rate: number; Amount: number }> = []
    for (const t of tenders) {
      const items = await db.query.constructionTenderBoqItems.findMany({ where: eq(constructionTenderBoqItems.tenderId, t.id) })
      for (const it of items) {
        results.push({
          "Tender Number": t.tenderNumber,
          "Item Code": it.itemCode ?? "",
          Description: it.description,
          Unit: it.unit,
          Quantity: Number(it.quantity ?? 0),
          Rate: Number(it.rate ?? 0),
          Amount: Number(it.amount ?? 0),
        })
      }
    }
    return results
  })
}

export async function preBidMeetingReport(ctx: { orgId: string }, tenderId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const tenders = tenderId
      ? await db.query.constructionTenders.findMany({ where: and(eq(constructionTenders.orgId, ctx.orgId), eq(constructionTenders.id, tenderId)) })
      : await db.query.constructionTenders.findMany({ where: eq(constructionTenders.orgId, ctx.orgId) })
    const results: Array<{ "Tender Number": string; "Meeting Date": string; "Queries Raised": string; "Clarifications Received": string }> = []
    for (const t of tenders) {
      const meetings = await db.query.constructionTenderPreBidMeetings.findMany({
        where: eq(constructionTenderPreBidMeetings.tenderId, t.id),
        orderBy: (m, { desc }) => [desc(m.meetingDate)],
      })
      for (const m of meetings) {
        results.push({
          "Tender Number": t.tenderNumber,
          "Meeting Date": m.meetingDate,
          "Queries Raised": m.queriesRaised ?? "",
          "Clarifications Received": m.clarificationsReceived ?? "",
        })
      }
    }
    return results
  })
}

export async function emdTrackingReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionTenders.findMany({
      where: eq(constructionTenders.orgId, ctx.orgId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
    return rows
      .filter((t) => Number(t.emdAmount ?? 0) > 0)
      .map((t) => ({
        "Tender Number": t.tenderNumber,
        Title: t.title,
        "EMD Amount": Number(t.emdAmount ?? 0),
        "EMD Status": t.emdStatus,
        Stage: t.stage,
      }))
  })
}

export async function contractAwardReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionTenders.findMany({
      where: and(eq(constructionTenders.orgId, ctx.orgId), eq(constructionTenders.stage, "awarded")),
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    })
    return rows.map((t) => ({
      "Tender Number": t.tenderNumber,
      Title: t.title,
      "Issuing Authority": t.issuingAuthority,
      "Estimated Value": Number(t.estimatedValue ?? 0),
      "Awarded Sales Order": t.contractAwardSalesOrderId ?? "",
      "Won At": t.wonAt ? t.wonAt.toISOString() : "",
    }))
  })
}
