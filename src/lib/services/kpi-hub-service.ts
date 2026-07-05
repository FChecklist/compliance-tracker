// Wave 98 (Comparison CSV 3 gap analysis: BI005/BI010 "Enterprise KPI Hub").
// A real cross-module executive scorecard computed live from existing
// compliance/risk/ERP/ticket/AI-ops data -- no new schema, no fabricated
// metrics. Reuses Wave 95's orchestra-analytics-service for the AI-ops
// section rather than re-deriving that aggregation.
import { complianceItems, risks, tickets, erpSalesInvoices } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { getOrchestraAnalytics, type OrchestraAnalyticsSummary } from "./orchestra-analytics-service"

export type KpiHubSummary = {
  compliance: {
    total: number
    completed: number
    overdue: number
    completionRate: number
  }
  risk: {
    totalOpen: number
    highSeverityOpen: number // likelihood * impact >= 15 (out of 25), the same "high" threshold the Risk Register UI already uses
  }
  revenue: {
    totalInvoicedYtd: number
    totalOutstandingAr: number
    overdueAr: number
  }
  tickets: {
    total: number
    open: number
    slaComplianceRate: number // of tickets resolved with a real SLA deadline, the fraction resolved on or before it
  }
  aiOps: OrchestraAnalyticsSummary
}

export async function getKpiHubSummary(ctx: { orgId: string }): Promise<KpiHubSummary> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)

    const [complianceStats] = await db.select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${complianceItems.status} = 'completed')`,
      overdue: sql<number>`count(*) filter (where ${complianceItems.status} = 'overdue' or (${complianceItems.status} not in ('completed', 'not_applicable') and ${complianceItems.dueDate} < now()))`,
    }).from(complianceItems).where(eq(complianceItems.orgId, ctx.orgId))

    const [riskStats] = await db.select({
      totalOpen: sql<number>`count(*)`,
      highSeverity: sql<number>`count(*) filter (where ${risks.likelihood} * ${risks.impact} >= 15)`,
    }).from(risks).where(and(eq(risks.orgId, ctx.orgId), eq(risks.status, "open")))

    const [revenueStats] = await db.select({
      totalInvoicedYtd: sql<number>`coalesce(sum(${erpSalesInvoices.grandTotal}) filter (where ${erpSalesInvoices.postingDate} >= ${yearStart} and ${erpSalesInvoices.status} != 'cancelled'), 0)`,
      totalOutstanding: sql<number>`coalesce(sum(${erpSalesInvoices.outstandingAmount}) filter (where ${erpSalesInvoices.status} != 'cancelled'), 0)`,
      overdueAr: sql<number>`coalesce(sum(${erpSalesInvoices.outstandingAmount}) filter (where ${erpSalesInvoices.status} != 'cancelled' and ${erpSalesInvoices.dueDate} < ${today} and ${erpSalesInvoices.outstandingAmount} > 0), 0)`,
    }).from(erpSalesInvoices).where(eq(erpSalesInvoices.orgId, ctx.orgId))

    const [ticketStats] = await db.select({
      total: sql<number>`count(*)`,
      open: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'in_progress'))`,
      resolvedWithSla: sql<number>`count(*) filter (where ${tickets.resolvedAt} is not null and ${tickets.slaDeadline} is not null)`,
      resolvedOnTime: sql<number>`count(*) filter (where ${tickets.resolvedAt} is not null and ${tickets.slaDeadline} is not null and ${tickets.resolvedAt} <= ${tickets.slaDeadline})`,
    }).from(tickets).where(eq(tickets.orgId, ctx.orgId))

    const resolvedWithSla = Number(ticketStats?.resolvedWithSla ?? 0)
    const resolvedOnTime = Number(ticketStats?.resolvedOnTime ?? 0)

    const aiOps = await getOrchestraAnalytics({ orgId: ctx.orgId }, 30)

    return {
      compliance: {
        total: Number(complianceStats?.total ?? 0),
        completed: Number(complianceStats?.completed ?? 0),
        overdue: Number(complianceStats?.overdue ?? 0),
        completionRate: Number(complianceStats?.total ?? 0) > 0 ? Number(complianceStats.completed) / Number(complianceStats.total) : 0,
      },
      risk: {
        totalOpen: Number(riskStats?.totalOpen ?? 0),
        highSeverityOpen: Number(riskStats?.highSeverity ?? 0),
      },
      revenue: {
        totalInvoicedYtd: Number(revenueStats?.totalInvoicedYtd ?? 0),
        totalOutstandingAr: Number(revenueStats?.totalOutstanding ?? 0),
        overdueAr: Number(revenueStats?.overdueAr ?? 0),
      },
      tickets: {
        total: Number(ticketStats?.total ?? 0),
        open: Number(ticketStats?.open ?? 0),
        slaComplianceRate: resolvedWithSla > 0 ? resolvedOnTime / resolvedWithSla : 0,
      },
      aiOps,
    }
  })
}

