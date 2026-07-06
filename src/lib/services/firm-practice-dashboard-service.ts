// Wave 108 (THE FIRM AI OS) -- read-only practice-management aggregation.
// No writes, no new stored "unified deadline" projection -- everything is
// computed at read time from tables that already exist, matching how
// pmsBudgets' own actuals are computed at read time rather than via a
// stored ledger. This is the data source for the (deferred, next-wave)
// in-app Practice Dashboard page and for the deadline-digest cron.
import { db, complianceItems, firmTaxCases, firmEngagementDeliverables, firmStaffAssignments, firmInvoices, orgProductBranchEnablements } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte, ne, isNotNull } from "drizzle-orm"
import { requireFirmEnabled } from "./firm-enablement-service"
import { computeStaffUtilization } from "./firm-staff-assignment-service"

export async function getStaffUtilizationSummary(ctx: { orgId: string }, periodStart: string, periodEnd: string) {
  await requireFirmEnabled(ctx.orgId)
  const staffUserIds = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const assignments = await db.query.firmStaffAssignments.findMany({ where: eq(firmStaffAssignments.orgId, ctx.orgId) })
    return Array.from(new Set(assignments.map((a) => a.userId)))
  })

  const summaries: Awaited<ReturnType<typeof computeStaffUtilization>>[] = []
  for (const userId of staffUserIds) {
    summaries.push(await computeStaffUtilization(ctx, userId, periodStart, periodEnd))
  }
  return summaries
}

export type UnifiedDeadline = {
  source: "compliance_item" | "firm_tax_case_due" | "firm_tax_case_limitation" | "firm_engagement_deliverable"
  id: string
  clientId: string | null
  title: string
  dueDate: string // ISO date string, always normalized for sorting/display
}

export async function getUpcomingDeadlines(ctx: { orgId: string }, withinDays: number): Promise<UnifiedDeadline[]> {
  await requireFirmEnabled(ctx.orgId)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + withinDays)
  const cutoffDateStr = cutoff.toISOString().slice(0, 10)
  const cutoffTimestamp = cutoff

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const deadlines: UnifiedDeadline[] = []

    const items = await db.query.complianceItems.findMany({
      where: and(eq(complianceItems.orgId, ctx.orgId), isNotNull(complianceItems.clientId), lte(complianceItems.dueDate, cutoffTimestamp), ne(complianceItems.status, "completed")),
    })
    for (const item of items) {
      deadlines.push({ source: "compliance_item", id: item.id, clientId: item.clientId, title: item.title, dueDate: item.dueDate.toISOString().slice(0, 10) })
    }

    const taxCases = await db.query.firmTaxCases.findMany({ where: eq(firmTaxCases.orgId, ctx.orgId) })
    for (const tc of taxCases) {
      if (tc.dueDate && tc.dueDate <= cutoffDateStr) {
        deadlines.push({ source: "firm_tax_case_due", id: tc.id, clientId: tc.clientId, title: `${tc.caseType} (AY ${tc.assessmentYear})`, dueDate: tc.dueDate })
      }
      if (tc.limitationDate && tc.limitationDate <= cutoffDateStr) {
        deadlines.push({ source: "firm_tax_case_limitation", id: tc.id, clientId: tc.clientId, title: `Limitation date -- ${tc.caseType} (AY ${tc.assessmentYear})`, dueDate: tc.limitationDate })
      }
    }

    const deliverables = await db.query.firmEngagementDeliverables.findMany({
      where: and(eq(firmEngagementDeliverables.orgId, ctx.orgId), ne(firmEngagementDeliverables.status, "done")),
    })
    for (const d of deliverables) {
      if (d.dueDate && d.dueDate <= cutoffDateStr) {
        deadlines.push({ source: "firm_engagement_deliverable", id: d.id, clientId: null, title: d.title, dueDate: d.dueDate })
      }
    }

    deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return deadlines
  })
}

export async function getRealizationSummary(ctx: { orgId: string }, periodStart: string, periodEnd: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoicesInPeriod = await db.query.firmInvoices.findMany({
      where: and(eq(firmInvoices.orgId, ctx.orgId), gte(firmInvoices.issueDate, periodStart), lte(firmInvoices.issueDate, periodEnd)),
      with: { lineItems: true },
    })

    let billed = 0
    let collected = 0
    for (const invoice of invoicesInPeriod) {
      billed += Number(invoice.totalAmount)
      if (invoice.status === "paid") collected += Number(invoice.totalAmount)
    }

    return { periodStart, periodEnd, billed, collected, invoiceCount: invoicesInPeriod.length }
  })
}

// Cron entrypoint (see src/app/api/internal/the-firm/deadline-digest/run/route.ts).
// Runs across every org, not scoped to one -- same raw-db-for-cross-org-
// scan convention as fm-ppm-service.ts's generateDueOccurrences() and
// metric-alert-service.ts's own cron entrypoint. Actual notification
// delivery (email/in-app) is deliberately not wired up this wave -- this
// computes and logs real per-org deadline data, it's just not dispatched
// to a notification channel yet.
export async function runFirmDeadlineDigest(): Promise<{ orgsScanned: number; totalDeadlines: number }> {
  const enabledBranches = await db.query.orgProductBranchEnablements.findMany({
    where: eq(orgProductBranchEnablements.isEnabled, true),
    with: { productBranch: true },
  })
  const firmOrgIds = enabledBranches
    .filter((e) => e.productBranch?.branchKey === "the_firm")
    .map((e) => e.orgId)

  let totalDeadlines = 0
  for (const orgId of firmOrgIds) {
    const deadlines = await getUpcomingDeadlines({ orgId }, 14)
    totalDeadlines += deadlines.length
    console.log(`[the-firm deadline digest] org ${orgId}: ${deadlines.length} deadline(s) within 14 days`)
  }

  return { orgsScanned: firmOrgIds.length, totalDeadlines }
}
