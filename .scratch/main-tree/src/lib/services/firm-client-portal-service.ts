// THE FIRM Client Portal -- magic-link access, exact same posture as
// erp-vendor-master-service.ts's getSupplierPortalData()/assertValidToken()
// (Wave 80's vendor portal): a token-bearer with no session gets a scoped
// read-only + narrow self-service-write view of their own client record,
// via the raw `db` export (bypasses RLS, since there's no org/session
// context a public route could run withTenantContext against).
import {
  db, firmClientPortalLinks, clients, firmEngagements, firmEngagementDeliverables, firmInvoices, documents, erpCurrencies,
} from "@/lib/db"
import { and, eq, ne } from "drizzle-orm"
import { requireFirmEnabled, withFirmTenantContext, type FirmServiceContext } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createId } from "@paralleldrive/cuid2"

const DEFAULT_EXPIRY_DAYS = 30

function assertValidToken(link: typeof firmClientPortalLinks.$inferSelect | undefined) {
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    throw new ServiceError("This client portal link is invalid or has expired", 404)
  }
}

export async function createClientPortalLink(ctx: FirmServiceContext, clientId: string, expiresInDays = DEFAULT_EXPIRY_DAYS) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, ctx.orgId)) })
    if (!client) throw new ServiceError("Client not found", 404)

    const [link] = await db.insert(firmClientPortalLinks).values({
      orgId: ctx.orgId, clientId, token: createId() + createId(), createdById: ctx.userId,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    }).returning()
    return link
  })
}

export async function listClientPortalLinks(ctx: FirmServiceContext, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, (db) =>
    db.query.firmClientPortalLinks.findMany({ where: and(eq(firmClientPortalLinks.clientId, clientId), eq(firmClientPortalLinks.orgId, ctx.orgId)), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function revokeClientPortalLink(ctx: FirmServiceContext, linkId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withFirmTenantContext(ctx, async (db) => {
    const [updated] = await db.update(firmClientPortalLinks).set({ revokedAt: new Date() })
      .where(and(eq(firmClientPortalLinks.id, linkId), eq(firmClientPortalLinks.orgId, ctx.orgId))).returning()
    if (!updated) throw new ServiceError("Portal link not found", 404)
    return updated
  })
}

// Public read -- everything a client should see about their own account:
// active engagements, their client-visible deliverables (the checklist),
// invoices (amounts/status only, never internal cost/margin data), and
// documents already on file for them.
export async function getClientPortalData(token: string) {
  const link = await db.query.firmClientPortalLinks.findFirst({ where: eq(firmClientPortalLinks.token, token) })
  assertValidToken(link)

  const client = await db.query.clients.findFirst({ where: eq(clients.id, link!.clientId) })
  if (!client) throw new ServiceError("This client portal link is invalid or has expired", 404)

  const engagements = await db.query.firmEngagements.findMany({
    where: and(eq(firmEngagements.clientId, client.id), ne(firmEngagements.status, "terminated")),
    orderBy: (t, { desc }) => desc(t.startDate),
  })
  const engagementIds = engagements.map((e) => e.id)

  const [deliverables, invoices, clientDocuments, baseCurrency] = await Promise.all([
    engagementIds.length > 0
      ? db.query.firmEngagementDeliverables.findMany({ where: eq(firmEngagementDeliverables.clientVisible, true) })
      : [],
    db.query.firmInvoices.findMany({ where: eq(firmInvoices.clientId, client.id), with: { lineItems: true }, orderBy: (t, { desc }) => desc(t.issueDate) }),
    db.query.documents.findMany({ where: eq(documents.clientId, client.id), orderBy: (t, { desc }) => desc(t.createdAt), limit: 50 }),
    // Priority 17 re-sweep fix: firmInvoices has no per-document currencyId
    // (org-scoped only, like erp_sales_invoices' null-currencyId case) --
    // this token page has no session, so it can't call the normal
    // session-authenticated /api/erp/currencies route; queried directly
    // here (raw `db`, same posture as the rest of this file) instead of via
    // erp-accounting-service.ts's listCurrencies(), which hard-gates on
    // requireErpEnabled() and would 403 for a firm-only org with no ERP
    // branch enabled.
    db.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.orgId, client.orgId), eq(erpCurrencies.isBaseCurrency, true)) }),
  ])
  const deliverablesForClient = deliverables.filter((d) => engagementIds.includes(d.engagementId))

  return {
    clientName: client.name,
    baseCurrencyCode: baseCurrency?.code ?? null,
    engagements: engagements.map((e) => ({ id: e.id, title: e.title, serviceLine: e.serviceLine, status: e.status, startDate: e.startDate, endDate: e.endDate })),
    deliverables: deliverablesForClient.map((d) => ({ id: d.id, engagementId: d.engagementId, title: d.title, dueDate: d.dueDate, status: d.status, submittedAt: d.submittedAt?.toISOString() ?? null })),
    invoices: invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, dueDate: i.dueDate, status: i.status,
      totalAmount: i.totalAmount, lineItems: i.lineItems.map((li) => ({ description: li.description, amount: li.amount })),
    })),
    documents: clientDocuments.map((d) => ({ id: d.id, name: d.name, category: d.category, createdAt: d.createdAt.toISOString() })),
  }
}

// Client-side self-service: mark a deliverable submitted (staff still
// reviews and moves it to "done"/completedAt separately -- see the
// completedAt vs submittedAt distinction in schema.ts). No auth beyond the
// token itself, same posture as submitBankAccountViaPortal.
export async function markDeliverableSubmittedViaPortal(token: string, deliverableId: string) {
  const link = await db.query.firmClientPortalLinks.findFirst({ where: eq(firmClientPortalLinks.token, token) })
  assertValidToken(link)

  const deliverable = await db.query.firmEngagementDeliverables.findFirst({ where: eq(firmEngagementDeliverables.id, deliverableId) })
  if (!deliverable || deliverable.orgId !== link!.orgId) throw new ServiceError("Deliverable not found", 404)

  const engagement = await db.query.firmEngagements.findFirst({ where: eq(firmEngagements.id, deliverable.engagementId) })
  if (!engagement || engagement.clientId !== link!.clientId) throw new ServiceError("Deliverable not found", 404)

  const [updated] = await db.update(firmEngagementDeliverables).set({ submittedAt: new Date(), status: deliverable.status === "pending" ? "in_progress" : deliverable.status, updatedAt: new Date() })
    .where(eq(firmEngagementDeliverables.id, deliverableId)).returning()
  return updated
}

export async function getPortalClientId(token: string): Promise<{ orgId: string; clientId: string }> {
  const link = await db.query.firmClientPortalLinks.findFirst({ where: eq(firmClientPortalLinks.token, token) })
  assertValidToken(link)
  return { orgId: link!.orgId, clientId: link!.clientId }
}
