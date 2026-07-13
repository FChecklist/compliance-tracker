// Wave 54 (VERI ERP gap-fill, Tier 3 #9): Bank Statement Import &
// Reconciliation -- entirely unbuilt before this wave. Reuses this
// codebase's own existing generic file parser (parseFile, already
// serving the compliance-item ingestion pipeline) instead of adding a
// new MT940/CAMT.053 dependency, per VAIOS_ARCHITECTURE_STRATEGY.md's
// finding that Indian banks overwhelmingly export CSV/Excel statements,
// not raw SWIFT MT940.
import { erpBankStatementImports, erpBankStatementLines, erpBankAccounts, erpJournalEntries, erpJournalEntryLines, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { parseFile } from "@/lib/ingest/parser"
import type { ParsedRow } from "@/lib/ingest/types"
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Heuristic header matching -- every bank exports slightly different
// column names (Date/Txn Date/Value Date, Narration/Description/
// Particulars, Withdrawal/Debit, Deposit/Credit) so this matches by
// keyword rather than requiring an exact template.
function findColumn(headers: string[], keywords: string[]): string | undefined {
  return headers.find((h) => keywords.some((k) => h.toLowerCase().includes(k)))
}

function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0
  const cleaned = String(value).replace(/[,₹\s]/g, "")
  const n = Number(cleaned)
  return isNaN(n) ? 0 : Math.abs(n)
}

function parseDate(value: string | number | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export async function importBankStatement(
  ctx: ErpContext,
  input: { bankAccountId: string; fileName: string; buffer: Buffer; mimeType: string }
) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const bankAccount = await db.query.erpBankAccounts.findFirst({ where: and(eq(erpBankAccounts.id, input.bankAccountId), eq(erpBankAccounts.orgId, ctx.orgId)) })
    if (!bankAccount) throw new ServiceError("Bank account not found", 404)

    const parsed = await parseFile(input.buffer, input.fileName, input.mimeType)
    if (parsed.rows.length === 0) throw new ServiceError("The uploaded file has no data rows", 400)

    const dateCol = findColumn(parsed.headers, ["date"])
    const descCol = findColumn(parsed.headers, ["narration", "description", "particulars", "details"])
    const refCol = findColumn(parsed.headers, ["reference", "chq", "cheque", "ref no", "utr"])
    const debitCol = findColumn(parsed.headers, ["debit", "withdrawal"])
    const creditCol = findColumn(parsed.headers, ["credit", "deposit"])
    const amountCol = findColumn(parsed.headers, ["amount"])
    if (!dateCol) throw new ServiceError(`Could not find a date column. Columns found: ${parsed.headers.join(", ")}`, 400)
    if (!debitCol && !creditCol && !amountCol) throw new ServiceError(`Could not find debit/credit or amount columns. Columns found: ${parsed.headers.join(", ")}`, 400)

    const validRows = parsed.rows
      .map((row: ParsedRow) => ({
        transactionDate: parseDate(row[dateCol]),
        description: descCol ? String(row[descCol] ?? "") : null,
        referenceNo: refCol ? String(row[refCol] ?? "") : null,
        debitAmount: debitCol ? parseAmount(row[debitCol]) : 0,
        creditAmount: creditCol ? parseAmount(row[creditCol]) : 0,
        // If only a single signed "Amount" column exists, treat negative as debit, positive as credit
        ...(amountCol && !debitCol && !creditCol
          ? (() => {
              const raw = Number(String(row[amountCol] ?? "0").replace(/[,₹\s]/g, ""))
              return { debitAmount: raw < 0 ? Math.abs(raw) : 0, creditAmount: raw > 0 ? raw : 0 }
            })()
          : {}),
      }))
      .filter((r) => r.transactionDate !== null)

    if (validRows.length === 0) throw new ServiceError("No rows had a parseable date -- check the file format", 400)

    const [imp] = await db.insert(erpBankStatementImports).values({
      orgId: ctx.orgId, bankAccountId: input.bankAccountId, fileName: input.fileName,
      totalLines: validRows.length, importedById: ctx.userId,
    }).returning()

    await db.insert(erpBankStatementLines).values(
      validRows.map((r) => ({
        orgId: ctx.orgId, importId: imp.id, transactionDate: r.transactionDate!, description: r.description,
        referenceNo: r.referenceNo, debitAmount: r.debitAmount.toString(), creditAmount: r.creditAmount.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_bank_statement.imported", entityType: "erp_bank_statement_import", entityId: imp.id, details: `${validRows.length} lines` })
    return { ...imp, totalLines: validRows.length }
  })
}

export async function listImports(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpBankStatementImports.findMany({ where: eq(erpBankStatementImports.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.importedAt) })
  })
}

export async function listLines(ctx: { orgId: string }, importId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpBankStatementLines.findMany({
      where: and(eq(erpBankStatementLines.orgId, ctx.orgId), eq(erpBankStatementLines.importId, importId)),
      orderBy: (t, { asc }) => asc(t.transactionDate),
    })
  })
}

/**
 * For a given unmatched line, suggest journal entries on the bank
 * account's own GL account with a matching amount within a +/-5-day
 * window -- a candidate list for a human to confirm, not an auto-match.
 */
export async function suggestMatches(ctx: { orgId: string }, lineId: string, bankGlAccountId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const line = await db.query.erpBankStatementLines.findFirst({ where: and(eq(erpBankStatementLines.id, lineId), eq(erpBankStatementLines.orgId, ctx.orgId)) })
    if (!line) throw new ServiceError("Statement line not found", 404)

    const amount = Number(line.debitAmount) > 0 ? Number(line.debitAmount) : Number(line.creditAmount)
    const isDebitLine = Number(line.debitAmount) > 0
    const txDate = new Date(line.transactionDate)
    const from = new Date(txDate); from.setDate(from.getDate() - 5)
    const to = new Date(txDate); to.setDate(to.getDate() + 5)

    const candidates = await db
      .select({ journalEntryId: erpJournalEntries.id, entryNumber: erpJournalEntries.entryNumber, postingDate: erpJournalEntries.postingDate, amount: sql<string>`${isDebitLine ? erpJournalEntryLines.credit : erpJournalEntryLines.debit}` })
      .from(erpJournalEntryLines)
      .innerJoin(erpJournalEntries, eq(erpJournalEntryLines.journalEntryId, erpJournalEntries.id))
      .where(and(
        eq(erpJournalEntries.orgId, ctx.orgId),
        eq(erpJournalEntryLines.accountId, bankGlAccountId),
        gte(erpJournalEntries.postingDate, from.toISOString().slice(0, 10)),
        lte(erpJournalEntries.postingDate, to.toISOString().slice(0, 10)),
        sql`${isDebitLine ? erpJournalEntryLines.credit : erpJournalEntryLines.debit} = ${amount.toString()}`
      ))

    return candidates
  })
}

export async function matchLine(ctx: ErpContext, lineId: string, journalEntryId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const line = await db.query.erpBankStatementLines.findFirst({ where: and(eq(erpBankStatementLines.id, lineId), eq(erpBankStatementLines.orgId, ctx.orgId)) })
    if (!line) throw new ServiceError("Statement line not found", 404)
    const [updated] = await db.update(erpBankStatementLines).set({ status: "matched", matchedJournalEntryId: journalEntryId }).where(eq(erpBankStatementLines.id, lineId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_bank_statement_line.matched", entityType: "erp_bank_statement_line", entityId: lineId })
    return updated
  })
}

export async function ignoreLine(ctx: ErpContext, lineId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpBankStatementLines).set({ status: "ignored" }).where(and(eq(erpBankStatementLines.id, lineId), eq(erpBankStatementLines.orgId, ctx.orgId))).returning()
    if (!updated) throw new ServiceError("Statement line not found", 404)
    return updated
  })
}
