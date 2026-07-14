// Minimal list-only service backing the Wave 52 Credit Notes UI's customer
// picker -- erpCustomers has existed since Wave 49 but had no service layer
// consumer until now.
//
// Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): adds create/update --
// nothing in this codebase had ever inserted a row into erp_customers
// outside of seed data, which made credit limits (this wave's actual goal)
// impossible to manage without a way to create/edit a customer at all.
//
// Priority 15 (PROJEXA Sales & CRM): adds Quotation + Sales Order CRUD.
// erp_quotations/erp_quotation_items/erp_sales_orders/erp_sales_order_items
// have existed in schema.ts since Wave 60 (the same wave that shipped
// erp-invoicing-service.ts) with ZERO service-layer consumer until now --
// only report-engine-service.ts ever read them, for read-only reporting
// aggregation. crm-service.ts's lead/opportunity pipeline (Wave 41/75/78) is
// deliberately NOT touched here -- it already covers lead->opportunity,
// this file picks up where it leaves off (opportunity/lead -> quotation ->
// sales order), matching ERPNext's own document-flow boundary between the
// CRM app and the Selling app. No GL posting on either document (unlike
// sales invoices) -- a quotation/sales order is a pre-billing commercial
// document, not a financial transaction, so no journal entry belongs here.
//
// Depth pass (Owner directive, same day: "dont just make MVP pages...
// complete indepth... for a mid size 100 employee construction firm...
// working on 500 projects"): adds quotation revisioning + an approval
// lifecycle before a quote can be sent, quote->sales-order conversion,
// project linkage on both documents, a real sales-order status lifecycle,
// DB-level pagination/search/filter on every list (500 projects/hundreds of
// customers means "fetch everything, filter client-side" doesn't hold up),
// bulk sales-order status updates, and getCustomerOverview() ("customer
// 360": opportunities + quotations + sales orders + sales invoices +
// linked projects for one erp_customers row in a single call).
import { erpCustomers, erpQuotations, erpQuotationItems, erpSalesOrders, erpSalesOrderItems, erpSalesInvoices, crmLeads, crmOpportunities, projects, users, organisations } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, ilike, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requireErpEnabled } from "./erp-enablement-service"
import { logActivity } from "@/lib/audit"
import type { PagedResult } from "./crm-service"

// Same discriminated actor shape as erp-invoicing-service.ts's
// createSalesInvoice -- a Bearer-API-key caller (PROJEXA's callVeridian(),
// which never carries a session cookie) never has a dbUser, so logActivity
// needs the apiKey branch wired through explicitly rather than assumed.
type SellingActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

function actorLogFields(ctx: SellingActorCtx) {
  return ctx.dbUser ? ({ dbUser: ctx.dbUser } as const) : ({ apiKey: ctx.apiKey } as const)
}

// ============================================================
// Customers
// ============================================================

export async function listCustomers(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCustomers.findMany({ where: eq(erpCustomers.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.customerName) })
  })
}

// Priority 15 depth pass: paginated/searchable variant, additive alongside
// the untouched listCustomers (the native /api/erp/selling/customers route
// still gets a flat array, unchanged behavior).
export async function listCustomersPaged(ctx: { orgId: string }, opts: { search?: string; page?: number; pageSize?: number } = {}): Promise<PagedResult<typeof erpCustomers.$inferSelect>> {
  await requireErpEnabled(ctx.orgId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(erpCustomers.orgId, ctx.orgId)]
    if (opts.search?.trim()) conditions.push(ilike(erpCustomers.customerName, `%${opts.search.trim()}%`))
    const where = and(...conditions)
    const [items, totalRows] = await Promise.all([
      db.query.erpCustomers.findMany({ where, orderBy: (t, { asc }) => asc(t.customerName), limit: pageSize, offset: (page - 1) * pageSize }),
      db.select({ count: sql<number>`count(*)` }).from(erpCustomers).where(where),
    ])
    return { items, total: Number(totalRows[0]?.count ?? 0), page, pageSize }
  })
}

export type CustomerInput = { customerName: string; gstin?: string; panNumber?: string; defaultPaymentTermsDays?: number; creditLimit?: number }

export async function createCustomer(ctx: { orgId: string }, input: CustomerInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerName?.trim()) throw new ServiceError("customerName is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [customer] = await db.insert(erpCustomers).values({
      orgId: ctx.orgId, customerName: input.customerName, gstin: input.gstin, panNumber: input.panNumber,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays, creditLimit: input.creditLimit?.toString(),
    }).returning()
    return customer
  })
}

export async function updateCustomer(ctx: { orgId: string }, customerId: string, input: Partial<CustomerInput>) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    const [updated] = await db.update(erpCustomers).set({
      ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
      ...(input.panNumber !== undefined ? { panNumber: input.panNumber } : {}),
      ...(input.defaultPaymentTermsDays !== undefined ? { defaultPaymentTermsDays: input.defaultPaymentTermsDays } : {}),
      ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit === null ? null : input.creditLimit.toString() } : {}),
    }).where(eq(erpCustomers.id, customerId)).returning()
    return updated
  })
}

// Priority 15 depth pass: "Customer 360" -- a single call aggregating
// everything the Selling pipeline knows about one erp_customers row:
// opportunities (via crm_opportunities.erp_customer_id, the new bridge
// column), every quotation revision, every sales order, every sales
// invoice, and the distinct set of construction projects any of those
// documents are attributed to. This is the read model a customer detail
// page needs -- not a new source of truth, every row here already exists
// and is independently listable via this file's other list* functions.
export async function getCustomerOverview(ctx: { orgId: string }, customerId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    const [opportunities, quotations, salesOrders, salesInvoices] = await Promise.all([
      db.query.crmOpportunities.findMany({ where: and(eq(crmOpportunities.orgId, ctx.orgId), eq(crmOpportunities.erpCustomerId, customerId)), orderBy: (t, { desc }) => desc(t.createdAt) }),
      db.query.erpQuotations.findMany({ where: and(eq(erpQuotations.orgId, ctx.orgId), eq(erpQuotations.customerId, customerId)), orderBy: (t, { desc }) => desc(t.quotationDate), with: { items: true } }),
      db.query.erpSalesOrders.findMany({ where: and(eq(erpSalesOrders.orgId, ctx.orgId), eq(erpSalesOrders.customerId, customerId)), orderBy: (t, { desc }) => desc(t.orderDate), with: { items: true } }),
      db.query.erpSalesInvoices.findMany({ where: and(eq(erpSalesInvoices.orgId, ctx.orgId), eq(erpSalesInvoices.customerId, customerId)), orderBy: (t, { desc }) => desc(t.postingDate) }),
    ])

    const projectIds = Array.from(new Set(
      [...quotations.map((q) => q.projectId), ...salesOrders.map((so) => so.projectId), ...salesInvoices.map((inv) => inv.projectId)].filter((id): id is string => !!id)
    ))
    const linkedProjects = projectIds.length
      ? await db.query.projects.findMany({ where: and(eq(projects.orgId, ctx.orgId), inArray(projects.id, projectIds)) })
      : []

    const lifetimeInvoiced = salesInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0)
    const lifetimeOutstanding = salesInvoices.reduce((sum, inv) => sum + Number(inv.outstandingAmount), 0)
    const openQuotationValue = quotations.filter((q) => !["ordered", "lost", "expired"].includes(q.status)).reduce((sum, q) => sum + Number(q.grandTotal), 0)
    const openSalesOrderValue = salesOrders.filter((so) => so.status !== "cancelled" && so.status !== "fulfilled").reduce((sum, so) => sum + Number(so.grandTotal), 0)

    return {
      customer, opportunities, quotations, salesOrders, salesInvoices, linkedProjects,
      summary: { lifetimeInvoiced, lifetimeOutstanding, openQuotationValue, openSalesOrderValue },
    }
  })
}

// ============================================================
// Quotations
// ============================================================

export type QuotationItemInput = { itemId?: string; description: string; quantity?: number; rate: number }

export type ListQuotationsOptions = { search?: string; status?: string; customerId?: string; projectId?: string; page?: number; pageSize?: number }

export async function listQuotations(ctx: { orgId: string }, opts: ListQuotationsOptions = {}): Promise<PagedResult<Awaited<ReturnType<typeof fetchQuotationPage>>["items"][number]>> {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) => fetchQuotationPage(db, ctx.orgId, opts))
}

async function fetchQuotationPage(db: TenantDb, orgId: string, opts: ListQuotationsOptions) {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  const conditions = [eq(erpQuotations.orgId, orgId)]
  if (opts.status) conditions.push(eq(erpQuotations.status, opts.status))
  if (opts.customerId) conditions.push(eq(erpQuotations.customerId, opts.customerId))
  if (opts.projectId) conditions.push(eq(erpQuotations.projectId, opts.projectId))
  const where = and(...conditions)
  // Wave 60's `customer` relation is a straight equality join and composes
  // fine with the conditions above; `search` needs a customer NAME match,
  // which the relational query builder can't filter on directly, so it's
  // applied as a post-fetch narrowing before pagination is sliced. Fine at
  // this scale (a firm's quotation volume, not a platform-wide table).
  const all = await db.query.erpQuotations.findMany({ where, orderBy: (t, { desc }) => desc(t.quotationDate), with: { items: true, customer: true } })
  const filtered = opts.search?.trim()
    ? all.filter((q) => q.customer?.customerName?.toLowerCase().includes(opts.search!.trim().toLowerCase()))
    : all
  const items = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
  return { items, total: filtered.length, page, pageSize }
}

export async function createQuotation(
  ctx: SellingActorCtx,
  input: { customerId?: string; leadId?: string; projectId?: string; quotationDate: string; validTill?: string; items: QuotationItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerId && !input.leadId) throw new ServiceError("A quotation needs a customerId or a leadId", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.customerId) {
      const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
      if (!customer) throw new ServiceError("Customer not found", 404)
    }
    if (input.leadId) {
      const lead = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, input.leadId), eq(crmLeads.orgId, ctx.orgId)) })
      if (!lead) throw new ServiceError("Lead not found", 404)
    }
    if (input.projectId) {
      const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
      if (!project) throw new ServiceError("Project not found", 404)
    }

    const quotation = await insertQuotationRow(db, ctx, {
      customerId: input.customerId ?? null, leadId: input.leadId ?? null, projectId: input.projectId ?? null,
      quotationDate: input.quotationDate, validTill: input.validTill ?? null, version: 1, revisionOf: null,
    }, input.items)

    await logActivity({ tx: db, orgId: ctx.orgId, ...actorLogFields(ctx), action: "erp_quotation.created", entityType: "erp_quotation", entityId: quotation.id })
    return quotation
  })
}

// Priority 15, Wave 2: single-quotation fetch with everything a PDF export
// needs in one call -- the quotation + its items + customer + the org's own
// letterhead details (name/address/GSTIN/PAN). Mirrors erp-einvoice-
// service.ts's generateEInvoicePayload() org-lookup pattern for the same
// class of GST-compliant outbound document. No prior single-quotation
// getter existed (list/create/revise/status/convert all query inline);
// added here rather than duplicated in the PDF route, matching this
// codebase's "business logic lives in the service, routes stay thin" rule.
export async function getQuotationForPdf(ctx: { orgId: string }, quotationId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const quotation = await db.query.erpQuotations.findFirst({
      where: and(eq(erpQuotations.id, quotationId), eq(erpQuotations.orgId, ctx.orgId)),
      with: { items: true, customer: true },
    })
    if (!quotation) throw new ServiceError("Quotation not found", 404)
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, ctx.orgId) })
    if (!org) throw new ServiceError("Organisation not found", 404)
    return { quotation, org }
  })
}

// Shared insert path for a fresh quotation and a revision -- keeps the
// numbering/totals/item-insert logic in exactly one place.
async function insertQuotationRow(
  db: TenantDb,
  ctx: { orgId: string; userId: string },
  header: { customerId: string | null; leadId: string | null; projectId: string | null; quotationDate: string; validTill: string | null; version: number; revisionOf: string | null },
  itemsInput: QuotationItemInput[]
) {
  const items = itemsInput.map((i) => ({ ...i, quantity: i.quantity ?? 1 }))
  const grandTotal = items.reduce((sum, i) => sum + i.quantity * i.rate, 0)
  const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpQuotations.quotationNumber}), 0)` }).from(erpQuotations).where(eq(erpQuotations.orgId, ctx.orgId))

  const [quotation] = await db.insert(erpQuotations).values({
    orgId: ctx.orgId, customerId: header.customerId, leadId: header.leadId, projectId: header.projectId,
    quotationNumber: Number(maxNumber) + 1, quotationDate: header.quotationDate, validTill: header.validTill,
    version: header.version, revisionOf: header.revisionOf,
    grandTotal: grandTotal.toString(), createdById: ctx.userId,
  }).returning()

  await db.insert(erpQuotationItems).values(
    items.map((i) => ({
      quotationId: quotation.id, itemId: i.itemId, description: i.description,
      quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(),
    }))
  )
  return quotation
}

// Priority 15 depth pass: a quote revision is a NEW row, not an in-place
// edit -- a customer-facing quote number's history is never silently
// rewritten (matches ERPNext's own "amend" convention for submitted
// documents). `revisionOf` always points at the version-1 root, so "every
// version of this quote" is one equality filter, not a recursive walk.
// Allowed from any pre-terminal status (draft/pending_approval/approved/
// sent) -- e.g. a price pushed back by the customer mid-negotiation --
// but not from ordered/lost/expired, which are final.
export async function createQuotationRevision(ctx: SellingActorCtx, quotationId: string, itemsOverride?: QuotationItemInput[]) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpQuotations.findFirst({ where: and(eq(erpQuotations.id, quotationId), eq(erpQuotations.orgId, ctx.orgId)), with: { items: true } })
    if (!existing) throw new ServiceError("Quotation not found", 404)
    if (["ordered", "lost", "expired"].includes(existing.status)) throw new ServiceError(`A '${existing.status}' quotation cannot be revised`, 409)

    const rootId = existing.revisionOf ?? existing.id
    const family = await db.query.erpQuotations.findMany({ where: and(eq(erpQuotations.orgId, ctx.orgId), sql`(${erpQuotations.id} = ${rootId} OR ${erpQuotations.revisionOf} = ${rootId})`) })
    const nextVersion = Math.max(...family.map((q) => q.version), existing.version) + 1

    const items = (itemsOverride ?? existing.items).map((i) => ({ itemId: i.itemId ?? undefined, description: i.description, quantity: Number(i.quantity), rate: Number(i.rate) }))
    const revision = await insertQuotationRow(db, ctx, {
      customerId: existing.customerId, leadId: existing.leadId, projectId: existing.projectId,
      quotationDate: new Date().toISOString().slice(0, 10), validTill: existing.validTill, version: nextVersion, revisionOf: rootId,
    }, items)

    await logActivity({ tx: db, orgId: ctx.orgId, ...actorLogFields(ctx), action: "erp_quotation.revised", entityType: "erp_quotation", entityId: revision.id, details: `Revision of ${existing.id} (v${existing.version} -> v${nextVersion})` })
    return revision
  })
}

const QUOTATION_STATUSES = ["draft", "pending_approval", "approved", "sent", "ordered", "lost", "expired"] as const
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]

// Priority 15 depth pass: a real approval gate before a quote can be sent --
// draft -> pending_approval -> approved -> sent -> ordered|lost|expired.
// pending_approval can also bounce back to draft (rejected). Enforced as an
// explicit transition table, not a free-for-all status setter.
const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "draft"],
  approved: ["sent"],
  sent: ["ordered", "lost", "expired"],
  ordered: [],
  lost: [],
  expired: [],
}

export async function updateQuotationStatus(ctx: { orgId: string; userId: string }, quotationId: string, status: QuotationStatus) {
  await requireErpEnabled(ctx.orgId)
  if (!QUOTATION_STATUSES.includes(status)) throw new ServiceError(`status must be one of ${QUOTATION_STATUSES.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpQuotations.findFirst({ where: and(eq(erpQuotations.id, quotationId), eq(erpQuotations.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Quotation not found", 404)
    const currentStatus = existing.status as QuotationStatus
    const allowed = QUOTATION_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(status)) {
      throw new ServiceError(`Cannot move a '${currentStatus}' quotation to '${status}' -- valid next status(es): ${allowed.length ? allowed.join(", ") : "none (terminal)"}`, 409)
    }
    const [updated] = await db.update(erpQuotations).set({ status }).where(eq(erpQuotations.id, quotationId)).returning()
    return updated
  })
}

// Priority 15 depth pass: quote -> sales order conversion. Only a 'sent'
// quotation (approved and already shown to the customer) can convert --
// this is the real-world moment a customer accepts. Copies the quotation's
// current line items into a new sales order at their existing rate/qty (a
// PROJEXA sales rep can still edit the resulting order before confirming
// it -- this function only creates it in 'draft').
export async function convertQuotationToSalesOrder(ctx: SellingActorCtx, quotationId: string, input: { orderDate: string; deliveryDate?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const quotation = await db.query.erpQuotations.findFirst({ where: and(eq(erpQuotations.id, quotationId), eq(erpQuotations.orgId, ctx.orgId)), with: { items: true } })
    if (!quotation) throw new ServiceError("Quotation not found", 404)
    if (quotation.status !== "sent") throw new ServiceError(`Only a 'sent' quotation can be converted to a sales order (this one is '${quotation.status}')`, 409)
    if (!quotation.customerId) throw new ServiceError("This quotation has no customer (lead-only quotations can't convert directly -- create the customer first)", 400)

    const items: SalesOrderItemInput[] = quotation.items.map((i) => ({ itemId: i.itemId ?? undefined, description: i.description, quantity: Number(i.quantity), rate: Number(i.rate) }))
    const salesOrder = await insertSalesOrderRow(db, ctx, {
      customerId: quotation.customerId, opportunityId: null, quotationId: quotation.id, projectId: quotation.projectId,
      orderDate: input.orderDate, deliveryDate: input.deliveryDate ?? null,
    }, items)

    await db.update(erpQuotations).set({ status: "ordered" }).where(eq(erpQuotations.id, quotationId))
    await logActivity({ tx: db, orgId: ctx.orgId, ...actorLogFields(ctx), action: "erp_quotation.converted_to_sales_order", entityType: "erp_quotation", entityId: quotationId, details: `Converted to sales order ${salesOrder.id}` })
    return salesOrder
  })
}

// ============================================================
// Sales Orders
// ============================================================

export type SalesOrderItemInput = { itemId?: string; description: string; quantity?: number; rate: number }

export type ListSalesOrdersOptions = { search?: string; status?: string; customerId?: string; projectId?: string; page?: number; pageSize?: number }

export async function listSalesOrders(ctx: { orgId: string }, opts: ListSalesOrdersOptions = {}): Promise<PagedResult<Awaited<ReturnType<typeof fetchSalesOrderPage>>["items"][number]>> {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) => fetchSalesOrderPage(db, ctx.orgId, opts))
}

async function fetchSalesOrderPage(db: TenantDb, orgId: string, opts: ListSalesOrdersOptions) {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  const conditions = [eq(erpSalesOrders.orgId, orgId)]
  if (opts.status) conditions.push(eq(erpSalesOrders.status, opts.status))
  if (opts.customerId) conditions.push(eq(erpSalesOrders.customerId, opts.customerId))
  if (opts.projectId) conditions.push(eq(erpSalesOrders.projectId, opts.projectId))
  const where = and(...conditions)
  const all = await db.query.erpSalesOrders.findMany({ where, orderBy: (t, { desc }) => desc(t.orderDate), with: { items: true, customer: true } })
  const filtered = opts.search?.trim()
    ? all.filter((so) => so.customer?.customerName?.toLowerCase().includes(opts.search!.trim().toLowerCase()))
    : all
  const items = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
  return { items, total: filtered.length, page, pageSize }
}

async function insertSalesOrderRow(
  db: TenantDb,
  ctx: { orgId: string; userId: string },
  header: { customerId: string; opportunityId: string | null; quotationId: string | null; projectId: string | null; orderDate: string; deliveryDate: string | null },
  itemsInput: SalesOrderItemInput[]
) {
  const items = itemsInput.map((i) => ({ ...i, quantity: i.quantity ?? 1 }))
  const grandTotal = items.reduce((sum, i) => sum + i.quantity * i.rate, 0)
  const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSalesOrders.soNumber}), 0)` }).from(erpSalesOrders).where(eq(erpSalesOrders.orgId, ctx.orgId))

  const [salesOrder] = await db.insert(erpSalesOrders).values({
    orgId: ctx.orgId, customerId: header.customerId, opportunityId: header.opportunityId, quotationId: header.quotationId, projectId: header.projectId,
    soNumber: Number(maxNumber) + 1, orderDate: header.orderDate, deliveryDate: header.deliveryDate,
    grandTotal: grandTotal.toString(), createdById: ctx.userId,
  }).returning()

  await db.insert(erpSalesOrderItems).values(
    items.map((i) => ({
      salesOrderId: salesOrder.id, itemId: i.itemId, description: i.description,
      quantity: i.quantity.toString(), rate: i.rate.toString(), amount: (i.quantity * i.rate).toString(),
    }))
  )
  return salesOrder
}

export async function createSalesOrder(
  ctx: SellingActorCtx,
  input: { customerId: string; opportunityId?: string; quotationId?: string; projectId?: string; orderDate: string; deliveryDate?: string; items: SalesOrderItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)
    if (input.opportunityId) {
      const opportunity = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, input.opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
      if (!opportunity) throw new ServiceError("Opportunity not found", 404)
    }
    if (input.quotationId) {
      const quotation = await db.query.erpQuotations.findFirst({ where: and(eq(erpQuotations.id, input.quotationId), eq(erpQuotations.orgId, ctx.orgId)) })
      if (!quotation) throw new ServiceError("Quotation not found", 404)
    }
    if (input.projectId) {
      const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
      if (!project) throw new ServiceError("Project not found", 404)
    }

    const salesOrder = await insertSalesOrderRow(db, ctx, {
      customerId: input.customerId, opportunityId: input.opportunityId ?? null, quotationId: input.quotationId ?? null, projectId: input.projectId ?? null,
      orderDate: input.orderDate, deliveryDate: input.deliveryDate ?? null,
    }, input.items)

    await logActivity({ tx: db, orgId: ctx.orgId, ...actorLogFields(ctx), action: "erp_sales_order.created", entityType: "erp_sales_order", entityId: salesOrder.id })
    return salesOrder
  })
}

const SALES_ORDER_STATUSES = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"] as const
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number]

const SALES_ORDER_TRANSITIONS: Record<SalesOrderStatus, readonly SalesOrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["partially_fulfilled", "fulfilled", "cancelled"],
  partially_fulfilled: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
}

export async function updateSalesOrderStatus(ctx: { orgId: string; userId: string }, salesOrderId: string, status: SalesOrderStatus) {
  await requireErpEnabled(ctx.orgId)
  if (!SALES_ORDER_STATUSES.includes(status)) throw new ServiceError(`status must be one of ${SALES_ORDER_STATUSES.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpSalesOrders.findFirst({ where: and(eq(erpSalesOrders.id, salesOrderId), eq(erpSalesOrders.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Sales order not found", 404)
    const currentStatus = existing.status as SalesOrderStatus
    const allowed = SALES_ORDER_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(status)) {
      throw new ServiceError(`Cannot move a '${currentStatus}' sales order to '${status}' -- valid next status(es): ${allowed.length ? allowed.join(", ") : "none (terminal)"}`, 409)
    }
    const [updated] = await db.update(erpSalesOrders).set({ status, updatedAt: new Date() }).where(eq(erpSalesOrders.id, salesOrderId)).returning()
    return updated
  })
}

// Priority 15 depth pass: bulk status update -- e.g. a sales manager
// confirming a batch of draft orders after a planning meeting. Each order
// is checked against the SAME transition table as the single-record path
// (no bypass), so orders already past the requested transition are
// reported back as skipped rather than silently ignored or erroring the
// whole batch.
export async function bulkUpdateSalesOrderStatus(ctx: { orgId: string; userId: string }, salesOrderIds: string[], status: SalesOrderStatus) {
  await requireErpEnabled(ctx.orgId)
  if (!salesOrderIds?.length) throw new ServiceError("salesOrderIds is required", 400)
  if (!SALES_ORDER_STATUSES.includes(status)) throw new ServiceError(`status must be one of ${SALES_ORDER_STATUSES.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const candidates = await db.query.erpSalesOrders.findMany({ where: and(eq(erpSalesOrders.orgId, ctx.orgId), inArray(erpSalesOrders.id, salesOrderIds)) })
    const eligibleIds = candidates.filter((so) => (SALES_ORDER_TRANSITIONS[so.status as SalesOrderStatus] ?? []).includes(status)).map((so) => so.id)
    const skippedIds = candidates.filter((so) => !eligibleIds.includes(so.id)).map((so) => so.id)
    const missingIds = salesOrderIds.filter((id) => !candidates.some((so) => so.id === id))

    const updated = eligibleIds.length
      ? await db.update(erpSalesOrders).set({ status, updatedAt: new Date() }).where(and(eq(erpSalesOrders.orgId, ctx.orgId), inArray(erpSalesOrders.id, eligibleIds))).returning()
      : []
    return { updated, skippedIds, missingIds }
  })
}
