// VERIDIAN Review Framework Wave B (2026-07-17): real gap confirmed via a
// fresh grep of src/ immediately before this wave -- crm_leads/
// crm_opportunities (Wave 41) had no persistent company-level "account"
// record and no person-level "contact" record underneath them. Full-depth
// build per the Owner's standing no-MVP directive, sized for a
// 100-employee/500-project firm: paginated/filtered account search, a real
// dedicated file (this one) rather than folding into crm-service.ts, since
// accounts+contacts+hierarchy is its own bounded concern the same way
// bcm-service.ts/access-review-service.ts each get their own file for a
// single domain. Gated behind the same 'sales' product branch as
// crm-service.ts (requireSalesEnabled) -- crm/accounts is a sibling surface
// under the same Sales & CRM nav section.
import { crmAccounts, crmContacts, crmLeads, crmOpportunities, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, sql } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
import type { PagedResult } from "./crm-service"
export { ServiceError }
export type { PagedResult }

export type CrmAccountContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type AccountRow = typeof crmAccounts.$inferSelect

// --- Pure helpers (unit-tested directly, no DB) ----------------------------

/**
 * Would setting account.parentAccountId = candidateParentId create a cycle
 * (an account becoming its own ancestor, directly or transitively)? Walks
 * the candidate's own ancestor chain looking for accountId. Returns true
 * for the trivial self-parent case too (candidateParentId === accountId).
 * `accounts` is the full org-scoped set (small enough at this scale -- a
 * 100-employee firm's account book is not the kind of fan-out that needs a
 * recursive CTE instead of an in-memory walk).
 */
export function wouldCreateCycle(
  accounts: Pick<AccountRow, "id" | "parentAccountId">[],
  accountId: string,
  candidateParentId: string | null
): boolean {
  if (!candidateParentId) return false
  if (candidateParentId === accountId) return true
  const byId = new Map(accounts.map((a) => [a.id, a]))
  let cursor: string | null = candidateParentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === accountId) return true
    if (seen.has(cursor)) return false // pre-existing cycle elsewhere in the data -- not this call's problem to detect
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentAccountId ?? null
  }
  return false
}

/**
 * Resolves the effective shipping address for an account: the account's own
 * shipping fields when shippingSameAsBilling is false, otherwise a mirror of
 * its billing fields. Centralizes the "same as billing" convenience so the
 * UI/API never has to duplicate the fallback logic.
 */
export function resolveAccountShippingAddress(account: {
  shippingSameAsBilling: boolean
  billingLine1: string | null; billingLine2: string | null; billingCity: string | null
  billingState: string | null; billingPostalCode: string | null; billingCountry: string | null
  shippingLine1: string | null; shippingLine2: string | null; shippingCity: string | null
  shippingState: string | null; shippingPostalCode: string | null; shippingCountry: string | null
}) {
  if (!account.shippingSameAsBilling) {
    return {
      line1: account.shippingLine1, line2: account.shippingLine2, city: account.shippingCity,
      state: account.shippingState, postalCode: account.shippingPostalCode, country: account.shippingCountry,
    }
  }
  return {
    line1: account.billingLine1, line2: account.billingLine2, city: account.billingCity,
    state: account.billingState, postalCode: account.billingPostalCode, country: account.billingCountry,
  }
}

// --- Accounts CRUD ----------------------------------------------------------

export type ListAccountsOptions = {
  search?: string; lifecycleStage?: string; ownerId?: string; parentAccountId?: string; companyId?: string
  page?: number; pageSize?: number
}

export async function listAccountsPaged(ctx: { orgId: string }, opts: ListAccountsOptions = {}): Promise<PagedResult<AccountRow>> {
  await requireSalesEnabled(ctx.orgId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(crmAccounts.orgId, ctx.orgId)]
    if (opts.lifecycleStage) conditions.push(eq(crmAccounts.lifecycleStage, opts.lifecycleStage as AccountRow["lifecycleStage"]))
    if (opts.ownerId) conditions.push(eq(crmAccounts.ownerId, opts.ownerId))
    if (opts.parentAccountId) conditions.push(eq(crmAccounts.parentAccountId, opts.parentAccountId))
    if (opts.companyId) conditions.push(eq(crmAccounts.companyId, opts.companyId))
    if (opts.search?.trim()) conditions.push(ilike(crmAccounts.name, `%${opts.search.trim()}%`))
    const where = and(...conditions)

    const [items, totalRows] = await Promise.all([
      db.query.crmAccounts.findMany({ where, orderBy: (t, { desc }) => desc(t.createdAt), limit: pageSize, offset: (page - 1) * pageSize }),
      db.select({ count: sql<number>`count(*)` }).from(crmAccounts).where(where),
    ])
    return { items, total: Number(totalRows[0]?.count ?? 0), page, pageSize }
  })
}

export async function getAccount(ctx: { orgId: string }, accountId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
  )
}

export type CreateAccountInput = {
  name: string; industry?: string; website?: string; ownerId?: string; parentAccountId?: string
  lifecycleStage?: string; companyId?: string
  billingLine1?: string; billingLine2?: string; billingCity?: string; billingState?: string; billingPostalCode?: string; billingCountry?: string
  shippingSameAsBilling?: boolean
  shippingLine1?: string; shippingLine2?: string; shippingCity?: string; shippingState?: string; shippingPostalCode?: string; shippingCountry?: string
}

export async function createAccount(ctx: CrmAccountContext, input: CreateAccountInput) {
  await requireSalesEnabled(ctx.orgId)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.parentAccountId) {
      const parent = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, input.parentAccountId), eq(crmAccounts.orgId, ctx.orgId)) })
      if (!parent) throw new ServiceError("Parent account not found", 404)
    }
    const [account] = await db.insert(crmAccounts).values({
      orgId: ctx.orgId, name, industry: input.industry || null, website: input.website || null,
      ownerId: input.ownerId || null, parentAccountId: input.parentAccountId || null,
      lifecycleStage: (input.lifecycleStage as AccountRow["lifecycleStage"]) || "prospect", companyId: input.companyId || null,
      billingLine1: input.billingLine1 || null, billingLine2: input.billingLine2 || null, billingCity: input.billingCity || null,
      billingState: input.billingState || null, billingPostalCode: input.billingPostalCode || null, billingCountry: input.billingCountry || null,
      shippingSameAsBilling: input.shippingSameAsBilling ?? true,
      shippingLine1: input.shippingLine1 || null, shippingLine2: input.shippingLine2 || null, shippingCity: input.shippingCity || null,
      shippingState: input.shippingState || null, shippingPostalCode: input.shippingPostalCode || null, shippingCountry: input.shippingCountry || null,
      createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.created", entityType: "crm_account", entityId: account.id })
    return account
  })
}

export type UpdateAccountInput = Partial<Omit<CreateAccountInput, "name">> & { name?: string }

export async function updateAccount(ctx: CrmAccountContext, accountId: string, patch: UpdateAccountInput) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Account not found", 404)

    if (patch.parentAccountId !== undefined && patch.parentAccountId !== null) {
      const allAccounts = await db.query.crmAccounts.findMany({ where: eq(crmAccounts.orgId, ctx.orgId), columns: { id: true, parentAccountId: true } })
      if (wouldCreateCycle(allAccounts, accountId, patch.parentAccountId)) {
        throw new ServiceError("This would create a circular parent-account hierarchy", 400)
      }
    }

    const [updated] = await db.update(crmAccounts)
      .set({ ...patch, lifecycleStage: patch.lifecycleStage as AccountRow["lifecycleStage"] | undefined, updatedAt: new Date() })
      .where(eq(crmAccounts.id, accountId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.updated", entityType: "crm_account", entityId: accountId })
    return updated
  })
}

// Closes the loop into the new crm_accounts table the same way
// convertLeadToClient() (crm-service.ts) already closes the loop into
// Wave-1 clients -- a lead that turns out to represent a real company
// worth account-managing (not just a one-off client record) converts here
// instead. Independent of convertLeadToClient(): a lead can be converted to
// a client, an account, both, or neither.
export async function convertLeadToAccount(ctx: CrmAccountContext, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const lead = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!lead) throw new ServiceError("Lead not found", 404)
    if (lead.accountId) throw new ServiceError("This lead is already linked to an account", 400)

    const [account] = await db.insert(crmAccounts).values({
      orgId: ctx.orgId, name: lead.name, lifecycleStage: "prospect", convertedFromLeadId: lead.id,
      ownerId: lead.ownerId, companyId: lead.companyId, createdById: ctx.userId,
    }).returning()
    const [updatedLead] = await db.update(crmLeads).set({ accountId: account.id, updatedAt: new Date() }).where(eq(crmLeads.id, leadId)).returning()
    // The lead's own contact details become the account's first contact,
    // if it had any -- otherwise the account starts with zero contacts and
    // one is added manually.
    if (lead.contactEmail || lead.contactPhone) {
      await db.insert(crmContacts).values({
        orgId: ctx.orgId, accountId: account.id, name: lead.name, email: lead.contactEmail || null,
        phone: lead.contactPhone || null, isPrimary: true, createdById: ctx.userId,
      })
    }
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.converted_from_lead", entityType: "crm_account", entityId: account.id, details: JSON.stringify({ leadId }) })
    return { account, lead: updatedLead }
  })
}

// Links an existing opportunity to an account -- e.g. once a deal's company
// is confirmed to be a tracked account rather than a bare lead/client
// reference.
export async function linkOpportunityToAccount(ctx: CrmAccountContext, opportunityId: string, accountId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [account, opportunity] = await Promise.all([
      db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) }),
      db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) }),
    ])
    if (!account) throw new ServiceError("Account not found", 404)
    if (!opportunity) throw new ServiceError("Opportunity not found", 404)
    const [updated] = await db.update(crmOpportunities).set({ accountId, updatedAt: new Date() }).where(eq(crmOpportunities.id, opportunityId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.opportunity_linked", entityType: "crm_account", entityId: accountId, details: JSON.stringify({ opportunityId }) })
    return updated
  })
}

// Everything rolled up under one account -- contacts roster, linked leads,
// linked opportunities. Backs the account detail page's single load call,
// same "one aggregate read" shape as crm-service.ts's getSalesPipelineOverview.
export async function getAccountOverview(ctx: { orgId: string }, accountId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const account = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
    if (!account) throw new ServiceError("Account not found", 404)

    const [contacts, leads, opportunities, childAccounts] = await Promise.all([
      db.query.crmContacts.findMany({ where: and(eq(crmContacts.accountId, accountId), eq(crmContacts.orgId, ctx.orgId)), orderBy: (t, { desc }) => desc(t.isPrimary) }),
      db.query.crmLeads.findMany({ where: and(eq(crmLeads.accountId, accountId), eq(crmLeads.orgId, ctx.orgId)) }),
      db.query.crmOpportunities.findMany({ where: and(eq(crmOpportunities.accountId, accountId), eq(crmOpportunities.orgId, ctx.orgId)) }),
      db.query.crmAccounts.findMany({ where: and(eq(crmAccounts.parentAccountId, accountId), eq(crmAccounts.orgId, ctx.orgId)) }),
    ])
    return { account, contacts, leads, opportunities, childAccounts }
  })
}

// --- Contacts CRUD -----------------------------------------------------------

export type CreateContactInput = { name: string; title?: string; email?: string; phone?: string; isPrimary?: boolean }

export async function createContact(ctx: CrmAccountContext, accountId: string, input: CreateContactInput) {
  await requireSalesEnabled(ctx.orgId)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const account = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
    if (!account) throw new ServiceError("Account not found", 404)

    if (input.isPrimary) {
      await db.update(crmContacts).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(crmContacts.accountId, accountId), eq(crmContacts.orgId, ctx.orgId)))
    }
    const [contact] = await db.insert(crmContacts).values({
      orgId: ctx.orgId, accountId, name, title: input.title || null, email: input.email || null,
      phone: input.phone || null, isPrimary: input.isPrimary ?? false, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_contact.created", entityType: "crm_contact", entityId: contact.id, details: JSON.stringify({ accountId }) })
    return contact
  })
}

export async function updateContact(ctx: CrmAccountContext, contactId: string, patch: Partial<CreateContactInput>) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmContacts.findFirst({ where: and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Contact not found", 404)

    if (patch.isPrimary === true) {
      await db.update(crmContacts).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(crmContacts.accountId, existing.accountId), eq(crmContacts.orgId, ctx.orgId)))
    }
    const [updated] = await db.update(crmContacts).set({ ...patch, updatedAt: new Date() }).where(eq(crmContacts.id, contactId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_contact.updated", entityType: "crm_contact", entityId: contactId })
    return updated
  })
}

export async function deleteContact(ctx: CrmAccountContext, contactId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmContacts.findFirst({ where: and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Contact not found", 404)
    await db.delete(crmContacts).where(eq(crmContacts.id, contactId))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_contact.deleted", entityType: "crm_contact", entityId: contactId, details: JSON.stringify({ accountId: existing.accountId }) })
    return { id: contactId }
  })
}

export async function listContactsForAccount(ctx: { orgId: string }, accountId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmContacts.findMany({ where: and(eq(crmContacts.accountId, accountId), eq(crmContacts.orgId, ctx.orgId)), orderBy: (t, { desc }) => desc(t.isPrimary) })
  )
}
