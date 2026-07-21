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
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, sql } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
import type { PagedResult } from "./crm-service"
// VERIDIAN Review Framework Wave 4 (2026-07-17): RBAC gate for this file.
// A parallel track in the same wave was asked to build a shared,
// cross-cutting permission-check utility (checked `gh pr list --state all`
// and `git branch -r` immediately before writing this -- no such PR/branch
// exists yet at the time this was written). Rather than inventing a new
// role model, this reuses the codebase's own real, established precedent
// for exactly this kind of resource-level gate: ROLE_RANK + a pure
// canDecideX()-style function, same shape as
// erp-payment-entries-service.ts's canDecidePaymentEntry() (Wave B payment
// approval) and the requireRole(dbUser, "manager") gate already used by
// v1/projexa/leads/bulk-reassign/route.ts. If the shared utility lands
// later with a different shape, the supervising session should replace
// canEditAccount/canReassignOrDeleteAccount below with calls into it --
// the call sites (this file + the 6 CRM accounts/contacts routes) are the
// only places that would need to change.
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
// Reuse the existing Email/Phone Validation Engine (VCEL Data Quality
// Engine) rather than hand-rolling a second email/phone regex -- see that
// file's own header for why generic email/phone validation uses standard
// npm libraries (validator.js / libphonenumber-js) in this codebase.
import { isValidEmail, isValidPhoneNumber } from "@/lib/engines/data-quality-engine"
export { ServiceError }
export type { PagedResult }

export type CrmAccountContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type AccountRow = typeof crmAccounts.$inferSelect

const MANAGER_RANK = ROLE_RANK.manager // 3 -- manager/senior_professional/branch_manager/admin/veridian_admin
const MEMBER_RANK = ROLE_RANK.member // 2 -- member/team_member and above (i.e. not viewer/client_viewer/external_auditor)

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

// --- Access control (pure, no DB) -------------------------------------------
// Grounded in a real construction/sales-org shape: a rep manages the
// accounts assigned to them (or any unowned/unclaimed account -- ownerId
// null, e.g. a freshly lead-converted account nobody has picked up yet),
// while a sales manager (or above) can act on any account in the org. This
// mirrors the existing precedent for owner-scoped write access + a
// manager-rank escalation elsewhere in this codebase (see
// v1/projexa/leads/bulk-reassign/route.ts's requireRole(ctx, "manager")
// and erp-payment-entries-service.ts's canDecidePaymentEntry()).

export type AccessGateResult = { ok: true } | { ok: false; reason: string }

/**
 * Who may edit an existing account's own fields (name, industry, address,
 * lifecycle stage, parent hierarchy, linking a contact/opportunity to it,
 * etc.) -- everything EXCEPT reassigning ownership or deleting the account,
 * see canReassignOrDeleteAccount below for that higher bar. A rep (member
 * rank or above) may edit an account they own, or an unowned account;
 * manager rank and above may edit any account regardless of owner.
 */
export function canEditAccount(actorRole: string, accountOwnerId: string | null, actorId: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MEMBER_RANK) return { ok: false, reason: "This action requires member role or higher" }
  if (actorRank >= MANAGER_RANK) return { ok: true }
  if (accountOwnerId === null || accountOwnerId === actorId) return { ok: true }
  return { ok: false, reason: "Only this account's owner or a manager can make this change" }
}

/**
 * Reassigning an account's owner (ownerId change to a value different from
 * the account's current owner) or deleting an account outright is a
 * team-lead-level action regardless of who currently owns it -- manager
 * rank or above only. Matches the existing bulk-reassign-leads precedent
 * (requireRole(dbUser, "manager") in v1/projexa/leads/bulk-reassign/route.ts).
 */
export function canReassignOrDeleteAccount(actorRole: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MANAGER_RANK) return { ok: false, reason: "This action requires manager role or higher" }
  return { ok: true }
}

/** Creating a brand-new account/contact has no existing owner to check against -- any rep (member rank+) can create. */
export function canCreateCrmRecord(actorRole: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MEMBER_RANK) return { ok: false, reason: "This action requires member role or higher" }
  return { ok: true }
}

function assertGate(gate: AccessGateResult): void {
  if (!gate.ok) throw new ServiceError(gate.reason, 403)
}

// --- Business-rule validation (pure, no DB) ---------------------------------

/**
 * Normalizes a website/URL down to a bare, lowercase domain for duplicate
 * matching -- "https://www.Acme.com/contact" and "acme.com" should be
 * recognized as the same company. Strips protocol, leading www., and any
 * path/query. Returns null for a blank/missing website (never matches
 * anything, including another blank website -- absence of a domain is not
 * itself a duplicate signal).
 */
export function extractDomain(website: string | null | undefined): string | null {
  const trimmed = website?.trim().toLowerCase()
  if (!trimmed) return null
  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//, "")
  const withoutWww = withoutProtocol.replace(/^www\./, "")
  const domain = withoutWww.split(/[/?#]/)[0].trim()
  return domain || null
}

function normalizeAccountName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Duplicate-account detection: same org + (case/whitespace-insensitive
 * exact name match OR same website domain). Real gap this closes -- before
 * this, nothing stopped two "Acme Corp" rows (or the same company entered
 * twice under slightly different casing) from existing side by side, with
 * no way for a rep creating the second one to even know the first exists.
 * Intentionally a soft block (see confirmDuplicate on CreateAccountInput/
 * UpdateAccountInput) rather than a hard unique constraint -- legitimate
 * same-name-different-company cases exist (e.g. two unrelated local
 * businesses named "Acme"), so the rep gets a warning + an explicit
 * override, not a silent failure.
 */
export function findDuplicateAccountMatches<T extends { id: string; name: string; website: string | null }>(
  candidates: T[],
  name: string,
  website: string | null | undefined,
  excludeAccountId?: string
): T[] {
  const normalizedName = normalizeAccountName(name)
  const domain = extractDomain(website)
  return candidates.filter((c) => {
    if (c.id === excludeAccountId) return false
    if (normalizeAccountName(c.name) === normalizedName) return true
    if (domain && extractDomain(c.website) === domain) return true
    return false
  })
}

/** Contact email/phone format validation -- beyond the DB's bare NOT NULL/text-column constraints. Blank/absent values are allowed (both fields are optional); only a NON-BLANK malformed value is rejected. */
export function validateContactFormat(input: { email?: string | null; phone?: string | null }): void {
  if (input.email?.trim() && !isValidEmail(input.email)) {
    throw new ServiceError(`"${input.email}" is not a valid email address`, 400)
  }
  if (input.phone?.trim() && !isValidPhoneNumber(input.phone)) {
    throw new ServiceError(`"${input.phone}" is not a valid phone number`, 400)
  }
}

async function findDuplicateAccountsInOrg(db: TenantDb, orgId: string, name: string, website: string | null | undefined, excludeAccountId?: string) {
  // Org-scoped in-memory scan, same performance assumption already
  // documented on wouldCreateCycle() above -- a 100-employee firm's account
  // book is not the kind of fan-out that needs a DB-side fuzzy-match query.
  const candidates = await db.query.crmAccounts.findMany({
    where: eq(crmAccounts.orgId, orgId),
    columns: { id: true, name: true, website: true },
  })
  return findDuplicateAccountMatches(candidates, name, website, excludeAccountId)
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
  // Set true to create anyway after the caller has already seen (and
  // dismissed) a 409 duplicate-account warning from findDuplicateAccountMatches().
  confirmDuplicate?: boolean
}

export async function createAccount(ctx: CrmAccountContext, input: CreateAccountInput) {
  await requireSalesEnabled(ctx.orgId)
  assertGate(canCreateCrmRecord(ctx.dbUser.role))
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.parentAccountId) {
      const parent = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, input.parentAccountId), eq(crmAccounts.orgId, ctx.orgId)) })
      if (!parent) throw new ServiceError("Parent account not found", 404)
    }

    if (!input.confirmDuplicate) {
      const duplicates = await findDuplicateAccountsInOrg(db, ctx.orgId, name, input.website)
      if (duplicates.length) {
        throw new ServiceError(
          `A similar account already exists: ${duplicates.map((d) => d.name).join(", ")}. Resubmit with confirmDuplicate: true to create it anyway.`,
          409
        )
      }
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

    // Ownership reassignment (ownerId changing to a genuinely different
    // value) is gated at manager rank regardless of who currently owns the
    // account; every other field edit follows the owner-or-manager gate.
    const isReassignment = patch.ownerId !== undefined && (patch.ownerId || null) !== existing.ownerId
    assertGate(isReassignment ? canReassignOrDeleteAccount(ctx.dbUser.role) : canEditAccount(ctx.dbUser.role, existing.ownerId, ctx.userId))

    if (patch.parentAccountId !== undefined && patch.parentAccountId !== null) {
      const allAccounts = await db.query.crmAccounts.findMany({ where: eq(crmAccounts.orgId, ctx.orgId), columns: { id: true, parentAccountId: true } })
      if (wouldCreateCycle(allAccounts, accountId, patch.parentAccountId)) {
        throw new ServiceError("This would create a circular parent-account hierarchy", 400)
      }
    }

    if ((patch.name !== undefined || patch.website !== undefined) && !patch.confirmDuplicate) {
      const nextName = patch.name !== undefined ? patch.name.trim() : existing.name
      const nextWebsite = patch.website !== undefined ? patch.website : existing.website
      const duplicates = await findDuplicateAccountsInOrg(db, ctx.orgId, nextName, nextWebsite, accountId)
      if (duplicates.length) {
        throw new ServiceError(
          `A similar account already exists: ${duplicates.map((d) => d.name).join(", ")}. Resubmit with confirmDuplicate: true to save anyway.`,
          409
        )
      }
    }

    // confirmDuplicate is a request-only flag (this function's own
    // duplicate-check gate above) -- not a crm_accounts column, must not be
    // spread into the update payload.
    const { confirmDuplicate: _confirmDuplicate, ...columns } = patch
    const [updated] = await db.update(crmAccounts)
      .set({ ...columns, lifecycleStage: columns.lifecycleStage as AccountRow["lifecycleStage"] | undefined, updatedAt: new Date() })
      .where(eq(crmAccounts.id, accountId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.updated", entityType: "crm_account", entityId: accountId })
    return updated
  })
}

/**
 * Deleting an account outright -- manager rank or above only (same bar as
 * reassignment, see canReassignOrDeleteAccount). Real referential-integrity
 * gap this closes: crm_accounts has no DB-level FK from crm_contacts/
 * child crm_accounts/crm_leads.accountId/crm_opportunities.accountId (this
 * schema's established bare-text bridge-column convention -- see this
 * table's own schema.ts comment), so nothing previously stopped an account
 * from being deleted out from under contacts/leads/opportunities that
 * still pointed at it, leaving orphaned accountId references with no way
 * to resolve them back to a real account. Blocks deletion instead, listing
 * what still needs to be reassigned or removed first.
 */
export async function deleteAccount(ctx: CrmAccountContext, accountId: string) {
  await requireSalesEnabled(ctx.orgId)
  assertGate(canReassignOrDeleteAccount(ctx.dbUser.role))
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Account not found", 404)

    const [contacts, childAccounts, leads, opportunities] = await Promise.all([
      db.query.crmContacts.findMany({ where: and(eq(crmContacts.accountId, accountId), eq(crmContacts.orgId, ctx.orgId)), columns: { id: true } }),
      db.query.crmAccounts.findMany({ where: and(eq(crmAccounts.parentAccountId, accountId), eq(crmAccounts.orgId, ctx.orgId)), columns: { id: true } }),
      db.query.crmLeads.findMany({ where: and(eq(crmLeads.accountId, accountId), eq(crmLeads.orgId, ctx.orgId)), columns: { id: true } }),
      db.query.crmOpportunities.findMany({ where: and(eq(crmOpportunities.accountId, accountId), eq(crmOpportunities.orgId, ctx.orgId)), columns: { id: true } }),
    ])
    const blockers: string[] = []
    if (contacts.length) blockers.push(`${contacts.length} contact(s)`)
    if (childAccounts.length) blockers.push(`${childAccounts.length} child account(s)`)
    if (leads.length) blockers.push(`${leads.length} linked lead(s)`)
    if (opportunities.length) blockers.push(`${opportunities.length} linked opportunity/opportunities`)
    if (blockers.length) {
      throw new ServiceError(
        `Cannot delete this account -- it still has ${blockers.join(", ")}. Reassign or remove them first.`,
        409
      )
    }

    await db.delete(crmAccounts).where(eq(crmAccounts.id, accountId))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "crm_account.deleted", entityType: "crm_account", entityId: accountId })
    return { id: accountId }
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
  assertGate(canCreateCrmRecord(ctx.dbUser.role)) // creates a brand-new account -- no pre-existing owner to check
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
    assertGate(canEditAccount(ctx.dbUser.role, account.ownerId, ctx.userId)) // mutates the account's linked-opportunity roster -- an account edit
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
  validateContactFormat(input)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const account = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, accountId), eq(crmAccounts.orgId, ctx.orgId)) })
    if (!account) throw new ServiceError("Account not found", 404)
    assertGate(canEditAccount(ctx.dbUser.role, account.ownerId, ctx.userId)) // adding a contact is an edit of the parent account's roster

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
  validateContactFormat(patch)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmContacts.findFirst({ where: and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Contact not found", 404)
    const parentAccount = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, existing.accountId), eq(crmAccounts.orgId, ctx.orgId)), columns: { ownerId: true } })
    assertGate(canEditAccount(ctx.dbUser.role, parentAccount?.ownerId ?? null, ctx.userId))

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
    const parentAccount = await db.query.crmAccounts.findFirst({ where: and(eq(crmAccounts.id, existing.accountId), eq(crmAccounts.orgId, ctx.orgId)), columns: { ownerId: true } })
    assertGate(canEditAccount(ctx.dbUser.role, parentAccount?.ownerId ?? null, ctx.userId))
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


// VERIDIAN CRM Wave 1 (2026-07-21) CRUD audit finding: createContact/
// updateContact/deleteContact/listContactsForAccount existed but no
// single-contact fetch by id -- every other CRM entity in this codebase
// (lead, opportunity, account) has a get-by-id; contacts didn't.
export async function getContact(ctx: { orgId: string }, contactId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmContacts.findFirst({ where: and(eq(crmContacts.id, contactId), eq(crmContacts.orgId, ctx.orgId)) })
  )
}


// VERIDIAN CRM Wave 3 (2026-07-21): real gap confirmed by reading this file
// fresh -- listContactsForAccount() requires an accountId, so there was no
// way to list every contact across an org's whole account book in one
// place. Same shape as listAccountsPaged() just above.
export type ListContactsOptions = { search?: string; accountId?: string; page?: number; pageSize?: number }

export async function listContactsPaged(ctx: { orgId: string }, opts: ListContactsOptions = {}): Promise<PagedResult<typeof crmContacts.$inferSelect>> {
  await requireSalesEnabled(ctx.orgId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(crmContacts.orgId, ctx.orgId)]
    if (opts.accountId) conditions.push(eq(crmContacts.accountId, opts.accountId))
    if (opts.search?.trim()) conditions.push(ilike(crmContacts.name, `%${opts.search.trim()}%`))
    const where = and(...conditions)

    const [items, totalRows] = await Promise.all([
      db.query.crmContacts.findMany({ where, orderBy: (t, { desc }) => desc(t.createdAt), limit: pageSize, offset: (page - 1) * pageSize }),
      db.select({ count: sql<number>`count(*)` }).from(crmContacts).where(where),
    ])
    return { items, total: Number(totalRows[0]?.count ?? 0), page, pageSize }
  })
}
