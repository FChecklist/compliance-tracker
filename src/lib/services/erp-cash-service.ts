// Wave 52 (VERI ERP gap-fill, Tier 2 #3): Cash Management -- entirely
// unbuilt before this wave (zero schema, per ERP_BENCHMARK_COMPARISON.md).
// Cash vouchers post a real balanced journal entry on submit (debit/credit
// the cash account's own GL account against a caller-specified
// counter-account), matching erp-accounting-service.ts's own
// period-lock-then-post pattern rather than inventing a second posting
// mechanism.
import { erpCashAccounts, erpCashVouchers, erpJournalEntries, erpJournalEntryLines, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { isPeriodOpenForDate } from "./erp-financial-report-service"
import { logActivity } from "@/lib/audit"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listCashAccounts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCashAccounts.findMany({ where: eq(erpCashAccounts.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.accountName) })
  })
}

export async function createCashAccount(ctx: ErpContext, input: { accountName: string; glAccountId?: string; isPettyCash?: boolean }) {
  if (!input.accountName?.trim()) throw new ServiceError("accountName is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [acc] = await db.insert(erpCashAccounts).values({
      orgId: ctx.orgId, accountName: input.accountName, glAccountId: input.glAccountId, isPettyCash: input.isPettyCash ?? false,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_cash_account.created", entityType: "erp_cash_account", entityId: acc.id })
    return acc
  })
}

export async function listCashVouchers(ctx: { orgId: string }, filters: { cashAccountId?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCashVouchers.findMany({
      where: filters.cashAccountId
        ? and(eq(erpCashVouchers.orgId, ctx.orgId), eq(erpCashVouchers.cashAccountId, filters.cashAccountId))
        : eq(erpCashVouchers.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
    })
  })
}

export type CashVoucherInput = {
  cashAccountId: string
  voucherType: "receipt" | "payment"
  amount: number
  againstAccountId: string // the other side of the balanced entry
  postingDate: string
  partyType?: "customer" | "supplier"
  partyId?: string
  remark?: string
}

/** Creates a cash voucher and immediately posts it (cash is inherently a same-day, no-draft-review instrument in every benchmarked ERP -- unlike journal entries there's no meaningful "draft cash receipt" state). */
export async function createAndPostCashVoucher(ctx: ErpContext, input: CashVoucherInput) {
  if (!input.cashAccountId || !input.againstAccountId) throw new ServiceError("cashAccountId and againstAccountId are required", 400)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be positive", 400)
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)

  const periodOpen = await isPeriodOpenForDate(ctx, input.postingDate)
  if (!periodOpen) throw new ServiceError(`The accounting period covering ${input.postingDate} is closed`, 409)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const cashAccount = await db.query.erpCashAccounts.findFirst({ where: and(eq(erpCashAccounts.id, input.cashAccountId), eq(erpCashAccounts.orgId, ctx.orgId)) })
    if (!cashAccount) throw new ServiceError("Cash account not found", 404)
    if (!cashAccount.glAccountId) throw new ServiceError("This cash account has no linked GL account -- set one before posting vouchers", 400)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpCashVouchers.voucherNumber}), 0)` }).from(erpCashVouchers).where(eq(erpCashVouchers.orgId, ctx.orgId))
    const [{ maxJeNumber }] = await db.select({ maxJeNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))

    const isReceipt = input.voucherType === "receipt"
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId,
      entryNumber: Number(maxJeNumber) + 1,
      postingDate: input.postingDate,
      referenceType: "erp_cash_voucher",
      userRemark: input.remark ?? `Cash ${input.voucherType}`,
      totalDebit: input.amount.toString(),
      totalCredit: input.amount.toString(),
      status: "submitted",
      createdById: ctx.userId,
      submittedAt: new Date(),
    }).returning()

    await db.insert(erpJournalEntryLines).values([
      {
        journalEntryId: je.id,
        accountId: cashAccount.glAccountId!,
        debit: isReceipt ? input.amount.toString() : "0",
        credit: isReceipt ? "0" : input.amount.toString(),
        partyType: input.partyType,
        partyId: input.partyId,
      },
      {
        journalEntryId: je.id,
        accountId: input.againstAccountId,
        debit: isReceipt ? "0" : input.amount.toString(),
        credit: isReceipt ? input.amount.toString() : "0",
        partyType: input.partyType,
        partyId: input.partyId,
      },
    ])

    const [voucher] = await db.insert(erpCashVouchers).values({
      orgId: ctx.orgId,
      cashAccountId: input.cashAccountId,
      voucherNumber: Number(maxNumber) + 1,
      voucherType: input.voucherType,
      amount: input.amount.toString(),
      partyType: input.partyType,
      partyId: input.partyId,
      postingDate: input.postingDate,
      status: "submitted",
      journalEntryId: je.id,
      remark: input.remark,
      createdById: ctx.userId,
    }).returning()

    await db.update(erpJournalEntries).set({ referenceId: voucher.id }).where(eq(erpJournalEntries.id, je.id))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_cash_voucher.posted", entityType: "erp_cash_voucher", entityId: voucher.id })
    return voucher
  })
}
