// VERIDIAN CRM Wave 1 (2026-07-21). Real gap confirmed by reading this
// schema fresh before writing this file: zero campaign concept existed
// anywhere (Zoho has a Campaigns module -- Create/Import, name, status,
// dates, see zoho-reverse-engineering/docs/crm/fields.md's addendum: "Plan
// Campaigns -- Campaigns are marketing efforts planned, executed, and
// monitored from within your CRM"). crm_leads.campaignId (added this same
// wave) lets a lead be attributed to the campaign that produced it, same
// bare-text/no-FK/nullable convention as this schema's other bridge
// columns. Own dedicated file, matching this codebase's precedent of one
// bounded concern per service file.
import { crmCampaigns } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"

export type CrmCampaignContext = { orgId: string; userId: string }

export type CreateCampaignInput = {
  name: string
  campaignType?: string
  status?: "planning" | "active" | "completed" | "cancelled"
  startDate?: string
  endDate?: string
  budgetedCost?: number
  actualCost?: number
  expectedRevenue?: number
  description?: string
  ownerId?: string
}

export async function createCampaign(ctx: CrmCampaignContext, input: CreateCampaignInput) {
  await requireSalesEnabled(ctx.orgId)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [campaign] = await db.insert(crmCampaigns).values({
      orgId: ctx.orgId,
      name,
      campaignType: input.campaignType || null,
      status: input.status || "planning",
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      budgetedCost: input.budgetedCost != null ? String(input.budgetedCost) : null,
      actualCost: input.actualCost != null ? String(input.actualCost) : null,
      expectedRevenue: input.expectedRevenue != null ? String(input.expectedRevenue) : null,
      description: input.description || null,
      ownerId: input.ownerId || null,
      createdById: ctx.userId,
    }).returning()
    return campaign
  })
}

export async function listCampaigns(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmCampaigns.findMany({ where: eq(crmCampaigns.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function getCampaign(ctx: { orgId: string }, campaignId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmCampaigns.findFirst({ where: and(eq(crmCampaigns.id, campaignId), eq(crmCampaigns.orgId, ctx.orgId)) })
  )
}

export async function updateCampaign(ctx: CrmCampaignContext, campaignId: string, patch: Partial<CreateCampaignInput>) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmCampaigns.findFirst({ where: and(eq(crmCampaigns.id, campaignId), eq(crmCampaigns.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Campaign not found", 404)
    const [updated] = await db.update(crmCampaigns).set({
      ...patch,
      budgetedCost: patch.budgetedCost != null ? String(patch.budgetedCost) : undefined,
      actualCost: patch.actualCost != null ? String(patch.actualCost) : undefined,
      expectedRevenue: patch.expectedRevenue != null ? String(patch.expectedRevenue) : undefined,
      updatedAt: new Date(),
    }).where(eq(crmCampaigns.id, campaignId)).returning()
    return updated
  })
}

export async function deleteCampaign(ctx: { orgId: string }, campaignId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmCampaigns.findFirst({ where: and(eq(crmCampaigns.id, campaignId), eq(crmCampaigns.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Campaign not found", 404)
    await db.delete(crmCampaigns).where(eq(crmCampaigns.id, campaignId))
    return { id: campaignId }
  })
}
