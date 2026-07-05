// Wave 50 (VERI ERP gap-fill): the first real service-layer consumer of
// both the accounting-period lock and the shared Approval Workflow Engine
// -- journal entries were schema-only since Wave 49, and per this
// codebase's own discipline (matching pms-issue-service.ts etc.), a
// gap-filling schema is only proven real once something actually posts
// through it. Submitting a journal entry now (a) refuses to post into a
// closed accounting period, and (b) starts an approval-workflow instance
// if the org has configured one for 'erp_journal_entry' -- if not, it
// posts immediately, matching every other module's current no-approval
// default behavior.
import { erpJournalEntries, erpJournalEntryLines, erpAccounts, erpCostCenters, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { isPeriodOpenForDate } from "./erp-financial-report-service"
import { startApprovalWorkflow } from "./approval-workflow-service"
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type JournalEntryLineInput = {
  accountId: string
  debit?: number
  credit?: number
  partyType?: "customer" | "supplier"
  partyId?: string
  costCenter?: string
  costCenterId?: string
  clientId?: string
  remark?: string
}

export type JournalEntryInput = {
  postingDate: string
  userRemark?: string
  referenceType?: string
  referenceId?: string
  lines: JournalEntryLineInput[]
}

function validateBalanced(lines: JournalEntryLineInput[]): { totalDebit: number; totalCredit: number } {
  if (!lines || lines.length < 2) throw new ServiceError("A journal entry needs at least 2 lines", 400)
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new ServiceError(`Debit (${totalDebit.toFixed(2)}) must equal credit (${totalCredit.toFixed(2)})`, 400)
  }
  return { totalDebit, totalCredit }
}

export async function listAccounts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpAccounts.findMany({ where: eq(erpAccounts.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.accountNumber) })
  })
}

export type AccountInput = {
  accountName: string
  accountNumber?: string
  rootType: "asset" | "liability" | "equity" | "income" | "expense"
  accountType?: string
  parentAccountId?: string
  isGroup?: boolean
}

export async function createAccount(ctx: ErpContext, input: AccountInput) {
  if (!input.accountName?.trim()) throw new ServiceError("accountName is required", 400)
  if (!input.rootType) throw new ServiceError("rootType is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [account] = await db.insert(erpAccounts).values({
      orgId: ctx.orgId,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      rootType: input.rootType,
      accountType: input.accountType,
      parentAccountId: input.parentAccountId,
      isGroup: input.isGroup ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_account.created", entityType: "erp_account", entityId: account.id })
    return account
  })
}

// Wave 52 (Tier 2 #4): upgrades the free-text costCenter tag on journal
// entry lines into a real dimension. listAccounts/createAccount above is
// the direct template.
export async function listCostCenters(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCostCenters.findMany({ where: eq(erpCostCenters.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  })
}

export type CostCenterInput = { name: string; parentCostCenterId?: string; isGroup?: boolean; departmentId?: string; projectId?: string }

export async function createCostCenter(ctx: ErpContext, input: CostCenterInput) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [cc] = await db.insert(erpCostCenters).values({
      orgId: ctx.orgId, name: input.name, parentCostCenterId: input.parentCostCenterId,
      isGroup: input.isGroup ?? false, departmentId: input.departmentId, projectId: input.projectId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_cost_center.created", entityType: "erp_cost_center", entityId: cc.id })
    return cc
  })
}

export async function listJournalEntries(ctx: { orgId: string }, filters: { status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpJournalEntries.findMany({
      where: filters.status
        ? and(eq(erpJournalEntries.orgId, ctx.orgId), eq(erpJournalEntries.status, filters.status as typeof erpJournalEntries.$inferSelect.status))
        : eq(erpJournalEntries.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
    })
  })
}

export async function getJournalEntry(ctx: { orgId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.erpJournalEntries.findFirst({ where: and(eq(erpJournalEntries.id, entryId), eq(erpJournalEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Journal entry not found", 404)
    const lines = await db.query.erpJournalEntryLines.findMany({ where: eq(erpJournalEntryLines.journalEntryId, entryId) })
    return { ...entry, lines }
  })
}

export async function createJournalEntry(ctx: ErpContext, input: JournalEntryInput) {
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)
  const { totalDebit, totalCredit } = validateBalanced(input.lines)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // Confirm every account referenced actually belongs to this org (cheap
    // guard against a stale/foreign accountId slipping through).
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))]
    const accounts = await db.query.erpAccounts.findMany({ where: and(eq(erpAccounts.orgId, ctx.orgId)) })
    const validIds = new Set(accounts.filter((a) => accountIds.includes(a.id)).map((a) => a.id))
    if (validIds.size !== accountIds.length) throw new ServiceError("One or more accounts were not found in this organisation", 400)

    // Per-org sequential entry number -- MAX+1 within this transaction,
    // matching this schema's own "per-org sequence" comment from Wave 49;
    // same lightweight approach every other ERP document number
    // (poNumber, orderNumber, receiptNumber) still uses since none of
    // them have a dedicated atomic counter yet either.
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))

    const [entry] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId,
      entryNumber: Number(maxNumber) + 1,
      postingDate: input.postingDate,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userRemark: input.userRemark,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpJournalEntryLines).values(
      input.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: (l.debit ?? 0).toString(),
        credit: (l.credit ?? 0).toString(),
        partyType: l.partyType,
        partyId: l.partyId,
        costCenter: l.costCenter,
        costCenterId: l.costCenterId,
        clientId: l.clientId,
        remark: l.remark,
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.created", entityType: "erp_journal_entry", entityId: entry.id })
    return entry
  })
}

/**
 * Submits a draft journal entry: refuses to post into a closed accounting
 * period, then either posts immediately (no workflow configured for this
 * org/entityType) or starts an approval-workflow instance and leaves the
 * entry in 'draft' until every step is approved (see
 * markJournalEntrySubmittedFromApproval, called from the approval-decide
 * route once an instance completes).
 */
export async function submitJournalEntry(ctx: ErpContext, entryId: string) {
  const entry = await getJournalEntry(ctx, entryId)
  if (entry.status !== "draft") throw new ServiceError("Only draft entries can be submitted", 409)

  const periodOpen = await isPeriodOpenForDate(ctx, entry.postingDate)
  if (!periodOpen) throw new ServiceError(`The accounting period covering ${entry.postingDate} is closed`, 409)

  const instance = await startApprovalWorkflow(ctx, {
    entityType: "erp_journal_entry",
    entityId: entryId,
    entityData: { totalDebit: Number(entry.totalDebit) },
  })

  if (!instance) {
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(erpJournalEntries).set({ status: "submitted", submittedAt: new Date() }).where(eq(erpJournalEntries.id, entryId)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.submitted", entityType: "erp_journal_entry", entityId: entryId })
      return { ...updated, pendingApproval: false }
    })
  }
  return { ...entry, pendingApproval: true, approvalInstanceId: instance.id }
}

/** Called from the approval-decide route once a journal entry's workflow instance reaches 'approved'. */
export async function markJournalEntrySubmittedFromApproval(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpJournalEntries).set({ status: "submitted", submittedAt: new Date() }).where(and(eq(erpJournalEntries.id, entryId), eq(erpJournalEntries.orgId, ctx.orgId))).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_journal_entry.approved_and_submitted", entityType: "erp_journal_entry", entityId: entryId })
    return updated
  })
}
