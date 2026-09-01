// R65 gap-closure (report_definitions data_gap cluster, 8 reports: 3D
// Design Approval, Design Consultation, Design Revision, Furniture Package,
// Interior Package Comparison, Modular Kitchen Sales, Room-wise Estimate,
// Wardrobe Sales Report). See schema.ts's own comment above
// interiorSalesPackages for why this is a genuinely new SALES-side entity,
// distinct from Wave 142/143's interiorFfeItems/interiorMoodBoards (DESIGN/
// EXECUTION-side infrastructure) and from erp_quotation_items/
// erp_sales_order_items (generic description/quantity/rate/amount lines
// with no interior-design package-tier or design-asset concept).
//
// "Design Revision Report" here is a simple CURRENT-revision counter
// (interiorSalesPackages.revisionNumber), not a full revision history log --
// that is explicitly a DIFFERENT report_definitions row ("Design Revision
// History") which is out of scope for this closure. Do not add a history
// table here to "complete" that other report; it needs its own pass.
//
// CRUD + the specific read-side aggregations each report needs, following
// this codebase's convention of query-time rollups over denormalized
// summary columns (matches construction-tender-service.ts/kpi-hub-service.ts).
import {
  interiorSalesPackages, interiorSalesPackageItems,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type PackageContext = { orgId: string; userId: string }

export type PackageInput = {
  projectId?: string | null
  opportunityId?: string | null
  quotationId?: string | null
  salesOrderId?: string | null
  packageType?: "furniture" | "modular_kitchen" | "wardrobe" | "room_wise_estimate" | "other"
  packageTier?: string | null
  roomOrArea?: string | null
  title: string
}

export type PackageItemInput = {
  description: string
  quantity: number
  rate: number
}

export function computePackageItemAmount(quantity: number, rate: number) {
  return Math.round(quantity * rate * 100) / 100
}

// ---- Design-approval state machine (pure + exported so it's unit-testable
// without a DB mock, same discipline as construction-tender-service.ts's
// isValidTenderStageTransition()) ----

const VALID_DESIGN_APPROVAL_TRANSITIONS: Record<string, string[]> = {
  not_started: ["in_progress"],
  in_progress: ["shared_for_approval"],
  shared_for_approval: ["approved", "revision_requested"],
  revision_requested: ["in_progress"],
  approved: [],
}

export function isValidDesignApprovalTransition(fromStatus: string, toStatus: string): boolean {
  return (VALID_DESIGN_APPROVAL_TRANSITIONS[fromStatus] ?? []).includes(toStatus)
}

// A new revision cycle begins when design work restarts after the client
// asked for changes -- moving OUT of 'revision_requested' back into
// 'in_progress'. Every other transition leaves the counter untouched. Pure
// so Design Revision Report's "how many times has this been revised" count
// is derived from one well-defined rule, not scattered write-site logic.
export function computeNextRevisionNumber(currentRevisionNumber: number, fromStatus: string, toStatus: string): number {
  if (fromStatus === "revision_requested" && toStatus === "in_progress") {
    return currentRevisionNumber + 1
  }
  return currentRevisionNumber
}

export async function listPackages(ctx: { orgId: string }, filters?: { packageType?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.interiorSalesPackages.findMany({
      where: filters?.packageType
        ? and(eq(interiorSalesPackages.orgId, ctx.orgId), eq(interiorSalesPackages.packageType, filters.packageType as any))
        : eq(interiorSalesPackages.orgId, ctx.orgId),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
  )
}

export async function getPackage(ctx: { orgId: string }, packageId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const pkg = await db.query.interiorSalesPackages.findFirst({
      where: and(eq(interiorSalesPackages.id, packageId), eq(interiorSalesPackages.orgId, ctx.orgId)),
    })
    if (!pkg) throw new ServiceError("Interior sales package not found", 404)
    const items = await db.query.interiorSalesPackageItems.findMany({
      where: eq(interiorSalesPackageItems.packageId, packageId),
    })
    return { ...pkg, items }
  })
}

export async function createPackage(ctx: PackageContext, input: PackageInput) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [pkg] = await db.insert(interiorSalesPackages).values({
      orgId: ctx.orgId,
      projectId: input.projectId ?? null,
      opportunityId: input.opportunityId ?? null,
      quotationId: input.quotationId ?? null,
      salesOrderId: input.salesOrderId ?? null,
      packageType: input.packageType ?? "other",
      packageTier: input.packageTier ?? null,
      roomOrArea: input.roomOrArea ?? null,
      title,
      createdById: ctx.userId,
    }).returning()
    return pkg
  })
}

export async function addPackageItems(ctx: PackageContext, packageId: string, items: PackageItemInput[]) {
  if (!items.length) return []
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const pkg = await db.query.interiorSalesPackages.findFirst({
      where: and(eq(interiorSalesPackages.id, packageId), eq(interiorSalesPackages.orgId, ctx.orgId)),
    })
    if (!pkg) throw new ServiceError("Interior sales package not found", 404)
    const inserted = await db.insert(interiorSalesPackageItems).values(
      items.map((it) => ({
        orgId: ctx.orgId,
        packageId,
        description: it.description,
        quantity: String(it.quantity),
        rate: String(it.rate),
        amount: String(computePackageItemAmount(it.quantity, it.rate)),
      }))
    ).returning()

    // Recompute totalValue from every real line item -- query-time rollup
    // recorded back onto the package (matches constructionTenderBoqItems'
    // own "amount computed by the service layer on write" convention), not
    // a value the caller passes in and could drift from the real items.
    const allItems = await db.query.interiorSalesPackageItems.findMany({
      where: eq(interiorSalesPackageItems.packageId, packageId),
    })
    const totalValue = allItems.reduce((sum, it) => sum + Number(it.amount ?? 0), 0)
    await db.update(interiorSalesPackages).set({
      totalValue: String(totalValue),
      updatedAt: new Date(),
    }).where(eq(interiorSalesPackages.id, packageId))

    return inserted
  })
}

export async function updateDesignApprovalStatus(ctx: PackageContext, packageId: string, newStatus: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const pkg = await db.query.interiorSalesPackages.findFirst({
      where: and(eq(interiorSalesPackages.id, packageId), eq(interiorSalesPackages.orgId, ctx.orgId)),
    })
    if (!pkg) throw new ServiceError("Interior sales package not found", 404)
    if (!isValidDesignApprovalTransition(pkg.designApprovalStatus, newStatus)) {
      throw new ServiceError(`Cannot transition design approval status from '${pkg.designApprovalStatus}' to '${newStatus}'`, 400)
    }
    const revisionNumber = computeNextRevisionNumber(pkg.revisionNumber, pkg.designApprovalStatus, newStatus)
    const [updated] = await db.update(interiorSalesPackages).set({
      designApprovalStatus: newStatus as any,
      revisionNumber,
      updatedAt: new Date(),
    }).where(eq(interiorSalesPackages.id, packageId)).returning()
    return updated
  })
}

export async function recordConsultationBooked(ctx: PackageContext, packageId: string, bookedAt: Date) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const pkg = await db.query.interiorSalesPackages.findFirst({
      where: and(eq(interiorSalesPackages.id, packageId), eq(interiorSalesPackages.orgId, ctx.orgId)),
    })
    if (!pkg) throw new ServiceError("Interior sales package not found", 404)
    const [updated] = await db.update(interiorSalesPackages).set({
      consultationBookedAt: bookedAt,
      updatedAt: new Date(),
    }).where(eq(interiorSalesPackages.id, packageId)).returning()
    return updated
  })
}

export async function recordConsultationHeld(ctx: PackageContext, packageId: string, heldAt: Date) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const pkg = await db.query.interiorSalesPackages.findFirst({
      where: and(eq(interiorSalesPackages.id, packageId), eq(interiorSalesPackages.orgId, ctx.orgId)),
    })
    if (!pkg) throw new ServiceError("Interior sales package not found", 404)
    if (!pkg.consultationBookedAt) {
      throw new ServiceError("Cannot record a consultation as held before it has been booked", 400)
    }
    const [updated] = await db.update(interiorSalesPackages).set({
      consultationHeldAt: heldAt,
      updatedAt: new Date(),
    }).where(eq(interiorSalesPackages.id, packageId)).returning()
    return updated
  })
}

// ---- Report-facing aggregations (consumed by report-engine-service.ts's
// FORMULA_REGISTRY -- see the interior_sales_* formula keys registered
// there) ----

export async function threeDDesignApprovalReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: eq(interiorSalesPackages.orgId, ctx.orgId),
      orderBy: (p, { desc }) => [desc(p.updatedAt)],
    })
    return rows.map((p) => ({
      Title: p.title,
      "Package Type": p.packageType,
      "Room/Area": p.roomOrArea ?? "",
      "Design Approval Status": p.designApprovalStatus,
      "Revision Number": p.revisionNumber,
      "Total Value": Number(p.totalValue ?? 0),
    }))
  })
}

export async function designConsultationReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: eq(interiorSalesPackages.orgId, ctx.orgId),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
    return rows
      .filter((p) => p.consultationBookedAt !== null)
      .map((p) => ({
        Title: p.title,
        "Package Type": p.packageType,
        "Consultation Booked At": p.consultationBookedAt ? p.consultationBookedAt.toISOString() : "",
        "Consultation Held At": p.consultationHeldAt ? p.consultationHeldAt.toISOString() : "",
        Status: p.consultationHeldAt ? "Held" : "Booked, not yet held",
      }))
  })
}

export async function designRevisionReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: eq(interiorSalesPackages.orgId, ctx.orgId),
      orderBy: (p, { desc }) => [desc(p.revisionNumber)],
    })
    return rows
      .filter((p) => p.revisionNumber > 1)
      .map((p) => ({
        Title: p.title,
        "Package Type": p.packageType,
        "Current Revision Number": p.revisionNumber,
        "Design Approval Status": p.designApprovalStatus,
      }))
  })
}

async function packagesByType(ctx: { orgId: string }, packageType: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: and(eq(interiorSalesPackages.orgId, ctx.orgId), eq(interiorSalesPackages.packageType, packageType as any)),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
    return rows.map((p) => ({
      Title: p.title,
      "Package Tier": p.packageTier ?? "",
      "Room/Area": p.roomOrArea ?? "",
      "Design Approval Status": p.designApprovalStatus,
      "Total Value": Number(p.totalValue ?? 0),
    }))
  })
}

export async function furniturePackageReport(ctx: { orgId: string }) {
  return packagesByType(ctx, "furniture")
}

export async function modularKitchenSalesReport(ctx: { orgId: string }) {
  return packagesByType(ctx, "modular_kitchen")
}

export async function wardrobeSalesReport(ctx: { orgId: string }) {
  return packagesByType(ctx, "wardrobe")
}

export async function roomWiseEstimateReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: and(eq(interiorSalesPackages.orgId, ctx.orgId), eq(interiorSalesPackages.packageType, "room_wise_estimate")),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
    return rows.map((p) => ({
      "Room/Area": p.roomOrArea ?? "",
      Title: p.title,
      "Package Tier": p.packageTier ?? "",
      "Total Value": Number(p.totalValue ?? 0),
      "Design Approval Status": p.designApprovalStatus,
    }))
  })
}

export async function interiorPackageComparisonReport(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.interiorSalesPackages.findMany({
      where: eq(interiorSalesPackages.orgId, ctx.orgId),
    })
    const byTier: Record<string, { count: number; totalValue: number }> = {}
    for (const p of rows) {
      const tier = p.packageTier ?? "(no tier set)"
      const bucket = (byTier[tier] ??= { count: 0, totalValue: 0 })
      bucket.count += 1
      bucket.totalValue += Number(p.totalValue ?? 0)
    }
    return Object.entries(byTier).map(([tier, v]) => ({
      "Package Tier": tier,
      Count: v.count,
      "Total Value": v.totalValue,
      "Average Value": v.count > 0 ? Math.round((v.totalValue / v.count) * 100) / 100 : 0,
    }))
  })
}
