// Deterministic GSTR-2B <-> Purchase Register reconciliation. Matching
// approach (composite key + amount-tolerance fallback) studied from how
// resilient-tech/india-compliance's and aerele/reconciler's reconciliation
// tools describe their own matching (GSTIN + invoice number + amount,
// exact/probable/mismatch buckets) -- GPL-3.0 tools, no code copied, this is
// an independent implementation of a standard, publicly-described technique.
import Decimal from "decimal.js"

export type ReconInvoice = {
  id: string
  counterpartyGstin: string | null
  invoiceNumber: string
  invoiceDate: string
  totalValue: string | number
}

export type ReconMatch = {
  purchaseInvoiceId: string | null
  gstr2bInvoiceId: string | null
  matchType: "exact" | "probable" | "mismatch" | "missing_in_2b" | "missing_in_books"
  confidenceScore: number
  deltaAmount: number
  notes: string | null
}

const AMOUNT_TOLERANCE = 1 // rupees
const DATE_WINDOW_DAYS = 3

function normalizeInvoiceNumber(n: string): string {
  return n.trim().toUpperCase().replace(/^0+/, "").replace(/[^A-Z0-9]/g, "")
}

function num(v: string | number): number {
  return typeof v === "number" ? v : parseFloat(v) || 0
}

function daysBetween(a: string, b: string): number {
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime())
  return diff / (1000 * 60 * 60 * 24)
}

/**
 * Matches every purchase-register invoice against GSTR-2B invoices for the
 * same period. Returns one ReconMatch per purchase invoice PLUS one per
 * unmatched 2B invoice (missing_in_books) -- so every row on both sides is
 * accounted for exactly once.
 */
export function reconcile(purchaseInvoices: ReconInvoice[], gstr2bInvoices: ReconInvoice[]): ReconMatch[] {
  const matches: ReconMatch[] = []
  const used2b = new Set<string>()

  // Primary index: gstin + normalized invoice number -> candidate 2B rows
  const index2b = new Map<string, ReconInvoice[]>()
  for (const inv of gstr2bInvoices) {
    const key = `${(inv.counterpartyGstin ?? "").toUpperCase()}|${normalizeInvoiceNumber(inv.invoiceNumber)}`
    if (!index2b.has(key)) index2b.set(key, [])
    index2b.get(key)!.push(inv)
  }

  for (const purchase of purchaseInvoices) {
    const key = `${(purchase.counterpartyGstin ?? "").toUpperCase()}|${normalizeInvoiceNumber(purchase.invoiceNumber)}`
    const candidates = (index2b.get(key) ?? []).filter(c => !used2b.has(c.id))

    if (candidates.length > 0) {
      const best = candidates[0]
      const delta = new Decimal(num(purchase.totalValue)).minus(num(best.totalValue)).abs().toNumber()
      used2b.add(best.id)
      matches.push(
        delta <= AMOUNT_TOLERANCE
          ? { purchaseInvoiceId: purchase.id, gstr2bInvoiceId: best.id, matchType: "exact", confidenceScore: 1, deltaAmount: delta, notes: null }
          : { purchaseInvoiceId: purchase.id, gstr2bInvoiceId: best.id, matchType: "mismatch", confidenceScore: 0.9, deltaAmount: delta, notes: `Invoice number and GSTIN match, but amount differs by ₹${delta.toFixed(2)}.` }
      )
      continue
    }

    // Fallback: same GSTIN, invoice date within a small window, amount within tolerance
    const fuzzyCandidate = gstr2bInvoices.find(c =>
      !used2b.has(c.id) &&
      c.counterpartyGstin && purchase.counterpartyGstin &&
      c.counterpartyGstin.toUpperCase() === purchase.counterpartyGstin.toUpperCase() &&
      daysBetween(c.invoiceDate, purchase.invoiceDate) <= DATE_WINDOW_DAYS &&
      new Decimal(num(c.totalValue)).minus(num(purchase.totalValue)).abs().toNumber() <= AMOUNT_TOLERANCE
    )
    if (fuzzyCandidate) {
      used2b.add(fuzzyCandidate.id)
      matches.push({
        purchaseInvoiceId: purchase.id, gstr2bInvoiceId: fuzzyCandidate.id, matchType: "probable", confidenceScore: 0.7, deltaAmount: 0,
        notes: `Matched by GSTIN + amount within ${DATE_WINDOW_DAYS} days -- invoice numbers differ ("${purchase.invoiceNumber}" vs "${fuzzyCandidate.invoiceNumber}"), likely a data-entry variation.`,
      })
      continue
    }

    matches.push({ purchaseInvoiceId: purchase.id, gstr2bInvoiceId: null, matchType: "missing_in_2b", confidenceScore: 0, deltaAmount: num(purchase.totalValue), notes: "In the purchase register but not found in GSTR-2B -- supplier may not have filed, or filed late." })
  }

  for (const inv of gstr2bInvoices) {
    if (!used2b.has(inv.id)) {
      matches.push({ purchaseInvoiceId: null, gstr2bInvoiceId: inv.id, matchType: "missing_in_books", confidenceScore: 0, deltaAmount: num(inv.totalValue), notes: "In GSTR-2B but not found in the purchase register -- check for an unrecorded purchase." })
    }
  }

  return matches
}

export function summarizeMatches(matches: ReconMatch[]) {
  return {
    exactMatches: matches.filter(m => m.matchType === "exact").length,
    probableMatches: matches.filter(m => m.matchType === "probable").length,
    mismatches: matches.filter(m => m.matchType === "mismatch").length,
    missingIn2b: matches.filter(m => m.matchType === "missing_in_2b").length,
    missingInBooks: matches.filter(m => m.matchType === "missing_in_books").length,
  }
}
