// Deterministic column auto-mapping -- no AI involved. First import for a
// client is fuzzy-matched against a known alias table (covering generic
// spreadsheet exports plus Tally/Busy/Zoho Books' own default column
// headers); the confirmed mapping is then saved to gst_source_profiles so
// every later import from that same software auto-maps at confidence 1.0.
export type CanonicalFieldKey =
  | "counterpartyGstin" | "counterpartyName" | "invoiceNumber" | "invoiceDate"
  | "placeOfSupply" | "invoiceType" | "taxableValue" | "cgstAmount" | "sgstAmount"
  | "igstAmount" | "cessAmount" | "totalValue" | "hsnSacCode" | "description"
  | "quantity" | "rate" | "gstRatePercent"

export const CANONICAL_FIELD_ALIASES: Record<CanonicalFieldKey, string[]> = {
  counterpartyGstin: ["gstin", "gst no", "gst number", "gstin uin", "gstin/uin", "supplier gstin", "buyer gstin", "party gstin", "gst identification number", "gst identification number gstin"],
  counterpartyName: ["party name", "supplier name", "customer name", "name", "party", "customer", "supplier", "trade name", "ledger name"],
  invoiceNumber: ["invoice no", "invoice number", "bill no", "bill number", "voucher no", "voucher number", "inv no", "document no", "reference number"],
  invoiceDate: ["invoice date", "date", "voucher date", "bill date", "document date"],
  placeOfSupply: ["place of supply", "pos", "state", "state code", "supply state"],
  invoiceType: ["invoice type", "type", "supply type", "gst treatment"],
  taxableValue: ["taxable value", "taxable amount", "taxable amt", "assessable value", "item total", "sub total", "subtotal"],
  cgstAmount: ["cgst", "cgst amount", "cgst amt", "central tax"],
  sgstAmount: ["sgst", "sgst amount", "sgst amt", "state tax", "utgst", "utgst amount"],
  igstAmount: ["igst", "igst amount", "igst amt", "integrated tax"],
  cessAmount: ["cess", "cess amount", "cess amt"],
  totalValue: ["total", "invoice value", "invoice total", "grand total", "total amount", "total value", "amount"],
  hsnSacCode: ["hsn", "hsn code", "hsn/sac", "hsn sac", "sac", "sac code", "hsn sac code"],
  description: ["description", "item", "item name", "particulars", "item description"],
  quantity: ["qty", "quantity"],
  rate: ["rate", "unit price", "price"],
  gstRatePercent: ["gst rate", "tax rate", "rate %", "gst %", "igst rate"],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

// Small, dependency-free Levenshtein distance -- used only as a fallback
// fuzzy signal when no alias matches exactly (e.g. a header with a typo or
// an unlisted regional variant).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export type ColumnMapping = Partial<Record<CanonicalFieldKey, string>>
export type MappingConfidence = Partial<Record<CanonicalFieldKey, number>>

const FUZZY_THRESHOLD = 0.72

/**
 * Maps raw spreadsheet headers to canonical fields. `savedMapping` (from
 * gst_source_profiles) is honored first at confidence 1.0 if its target
 * header is still present; everything else falls through to alias/fuzzy
 * matching so a brand-new source still gets a usable first-pass mapping.
 */
export function autoMapColumns(headers: string[], savedMapping?: ColumnMapping): { mapping: ColumnMapping; confidence: MappingConfidence } {
  const normalizedHeaders = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }))
  const mapping: ColumnMapping = {}
  const confidence: MappingConfidence = {}
  const usedHeaders = new Set<string>()

  const fields = Object.keys(CANONICAL_FIELD_ALIASES) as CanonicalFieldKey[]

  for (const field of fields) {
    const saved = savedMapping?.[field]
    if (saved && headers.includes(saved) && !usedHeaders.has(saved)) {
      mapping[field] = saved
      confidence[field] = 1
      usedHeaders.add(saved)
      continue
    }

    const aliases = CANONICAL_FIELD_ALIASES[field]
    let best: { raw: string; score: number } | null = null
    for (const { raw, norm } of normalizedHeaders) {
      if (usedHeaders.has(raw)) continue
      for (const alias of aliases) {
        const score = norm === alias ? 1 : similarity(norm, alias)
        if (!best || score > best.score) best = { raw, score }
      }
    }
    if (best && best.score >= FUZZY_THRESHOLD) {
      mapping[field] = best.raw
      confidence[field] = best.score
      usedHeaders.add(best.raw)
    }
  }

  return { mapping, confidence }
}

// R11 point 6a (E-44): parseAmount used to strip only commas/whitespace/the
// rupee glyph, so a non-INR cell (Sumeet's contract is in AED, e.g. "AED
// 50,976.00") left its currency CODE in place -- "AED50976.00" -> parseFloat
// -> NaN -> silently coerced to 0. Now strips any leading currency TOKEN (a
// 3-letter ISO code like AED/USD, or a symbol like $/€) after stripping
// commas/whitespace, so any currency prefix is removed, not just ₹. The
// currency-token strip explicitly leaves a leading "(" alone (excluded from
// its character class) and runs BEFORE the parentheses-negative conversion,
// so "AED (100)" still becomes -100 instead of silently losing its sign --
// stripping "AED(" as one blind run would eat the "(" too and turn a real
// negative into a positive. Return type and behaviour for already-numeric/
// valid input are unchanged: a leading digit, ".", or "-" is never touched,
// so "30%" (parseFloat stops at the "%") and plain numbers/percentages are
// unaffected.
export function parseAmount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return value
  const cleaned = String(value)
    .replace(/[,₹\s]/g, "") // strip commas/rupee glyph/whitespace
    .replace(/^[^\d.\-(]+/, "") // strip a leading currency token (AED, USD, $, €, ...), but never a leading "(" -- that's parentheses-negative syntax, handled next
    .replace(/^\((.*)\)$/, "-$1") // treat (100) as -100
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

// E-43: parseAmount() above gracefully degrades any genuinely-unparseable
// cell ("not-a-number", "TBD", "N/A", a stray word) to 0 -- correct for a
// caller that just wants a number, but every GST adapter call site used it
// directly on raw amount/quantity/rate cells with no upstream check, so a
// typo or placeholder silently became a real $0 taxable value / tax amount
// with zero warning (AR-05 violation) -- indistinguishable from a cell that
// genuinely says "0". Same fix shape as construction-boq-import-service.ts's
// isMalformedNumericCell() (R-71/TC-51), which solved this exact problem for
// the BOQ import path first: mirror parseAmount's own cleaning steps, then
// test what's left against a plain numeric pattern, so every shape
// parseAmount itself already accepts ("5,000", "AED 50", "(100)") is never
// flagged and only true garbage is.
//
// One real difference from the BOQ version, because it is copied nowhere
// near verbatim: GST has amount cells the BOQ importer never sees --
// gstRatePercent columns (aliases include "rate %", "gst %") legitimately
// carry a trailing "%" ("18%", not just "18"), and parseAmount already
// tolerates that (parseFloat stops at the first invalid char, so
// parseFloat("18%") === 18). A bare regex mirror without this trailing-"%"
// strip would flag every percent-formatted GST-rate cell as malformed even
// though parseAmount parses it correctly -- so this strips one optional
// trailing "%" before the numeric test, same as the cleaning steps it mirrors.
export function isMalformedNumericCell(raw: string): boolean {
  if (raw === "") return false
  const cleaned = raw
    .replace(/[,₹\s]/g, "")
    .replace(/^[^\d.\-(]+/, "")
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/%$/, "")
  return !/^-?\d+(\.\d+)?$/.test(cleaned)
}

// Accepts common Indian date formats (dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd) and
// normalizes to ISO. xlsx's own dateNF already yields yyyy-mm-dd for real
// Excel date cells; this covers CSV/text dates that arrive as plain strings.
export function parseDateToIso(value: unknown): string | null {
  if (!value) return null
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (dmy) {
    const [, d, m, yRaw] = dmy
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export function applyMapping(row: Record<string, unknown>, mapping: ColumnMapping): Record<CanonicalFieldKey, unknown> {
  const out = {} as Record<CanonicalFieldKey, unknown>
  for (const [field, header] of Object.entries(mapping) as [CanonicalFieldKey, string][]) {
    out[field] = row[header]
  }
  return out
}
