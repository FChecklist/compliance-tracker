// Adapter for Tally XML exports (Gateway of Tally > Export > Data, "Vouchers"
// with XML format -- Tally's own documented XML data-interchange schema, not
// third-party GPL code). A voucher's real ledger-entry structure varies with
// how the user's Tally company is configured (tax ledgers named differently
// per company), so this reads the fields that are structurally fixed by
// Tally's schema (VOUCHERNUMBER/DATE/PARTYLEDGERNAME/amount) and infers the
// GST split from the ledger names it does find (matching "CGST"/"SGST"/
// "IGST" case-insensitively) -- the same approach column-mapper.ts uses for
// spreadsheet headers, applied to Tally's LEDGERNAME instead.
import { XMLParser } from "fast-xml-parser"
import { parseAmount, parseDateToIso, isMalformedNumericCell } from "@/lib/gst/column-mapper"
import type { CanonicalInvoiceDraft, StagedRow } from "@/lib/gst/canonical-types"
import { stateCodeFromGstin } from "@/lib/engines/in/gst-engine"

// E-43: same silent-zero problem as the spreadsheet adapter (see
// column-mapper.ts's isMalformedNumericCell), applied to Tally's own
// AMOUNT/ACTUALQTY/RATE fields. A hand-edited or corrupted Tally XML export
// can carry a non-numeric AMOUNT/RATE/QTY just as easily as a spreadsheet
// cell can -- Tally's schema fixes the TAG names, not what a buggy exporter
// puts inside them.
function readAmount(rawValue: string | number | undefined, label: string, warnings: string[]): number {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim()
    if (isMalformedNumericCell(trimmed)) warnings.push(`${label} "${trimmed}" is not a number -- imported as 0`)
  }
  return parseAmount(rawValue)
}

type TallyLedgerEntry = { LEDGERNAME?: string; AMOUNT?: string | number; ISPARTYLEDGER?: string }
type TallyInventoryEntry = { STOCKITEMNAME?: string; HSNCODE?: string; ACTUALQTY?: string; RATE?: string; AMOUNT?: string | number }
type TallyVoucher = {
  DATE?: string
  VOUCHERNUMBER?: string
  PARTYLEDGERNAME?: string
  PARTYGSTIN?: string
  PLACEOFSUPPLY?: string
  "ALLLEDGERENTRIES.LIST"?: TallyLedgerEntry | TallyLedgerEntry[]
  "LEDGERENTRIES.LIST"?: TallyLedgerEntry | TallyLedgerEntry[]
  "INVENTORYENTRIES.LIST"?: TallyInventoryEntry | TallyInventoryEntry[]
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function classifyLedger(name: string): "cgst" | "sgst" | "igst" | "other" {
  const n = name.toLowerCase()
  if (n.includes("cgst") || n.includes("central tax")) return "cgst"
  if (n.includes("sgst") || n.includes("utgst") || n.includes("state tax")) return "sgst"
  if (n.includes("igst") || n.includes("integrated tax")) return "igst"
  return "other"
}

export function adaptTallyXml(xmlText: string): { rows: StagedRow[] } {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true })
  const doc = parser.parse(xmlText)

  const messages = toArray(doc?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE)
  const vouchers = messages.map(m => m?.VOUCHER as TallyVoucher | undefined).filter((v): v is TallyVoucher => !!v)

  const rows: StagedRow[] = vouchers.map((v, idx) => {
    const ledgerEntries = [...toArray(v["ALLLEDGERENTRIES.LIST"]), ...toArray(v["LEDGERENTRIES.LIST"])]
    const inventoryEntries = toArray(v["INVENTORYENTRIES.LIST"])

    const warnings: string[] = []
    let taxableValue = 0, cgstAmount = 0, sgstAmount = 0, igstAmount = 0
    for (const entry of ledgerEntries) {
      const amount = Math.abs(readAmount(entry.AMOUNT, `Ledger "${entry.LEDGERNAME ?? "unnamed"}" amount`, warnings))
      const kind = classifyLedger(entry.LEDGERNAME ?? "")
      if (kind === "cgst") cgstAmount += amount
      else if (kind === "sgst") sgstAmount += amount
      else if (kind === "igst") igstAmount += amount
      else if (entry.ISPARTYLEDGER !== "Yes") taxableValue += amount // non-party, non-tax ledger -- treat as the sale/purchase value line
    }

    // Read each inventory entry's amount/qty/rate exactly once (not
    // re-parsed for the fallback below) so a malformed cell is warned about
    // once, not once per place its parsed value gets reused.
    const items = inventoryEntries.map(e => ({
      hsnSacCode: e.HSNCODE ? String(e.HSNCODE).trim() : null,
      description: e.STOCKITEMNAME ? String(e.STOCKITEMNAME).trim() : null,
      quantity: readAmount(e.ACTUALQTY, `Inventory "${e.STOCKITEMNAME ?? "unnamed"}" quantity`, warnings) || 1,
      rate: readAmount(e.RATE, `Inventory "${e.STOCKITEMNAME ?? "unnamed"}" rate`, warnings),
      taxableValue: Math.abs(readAmount(e.AMOUNT, `Inventory "${e.STOCKITEMNAME ?? "unnamed"}" amount`, warnings)),
      gstRatePercent: 0,
      cgstAmount: 0, sgstAmount: 0, igstAmount: 0,
    }))
    // Fallback: if no non-tax ledger line was found, derive taxable value from inventory entries
    if (taxableValue === 0 && items.length > 0) {
      taxableValue = items.reduce((sum, item) => sum + item.taxableValue, 0)
    }

    const totalValue = taxableValue + cgstAmount + sgstAmount + igstAmount
    const gstin = v.PARTYGSTIN ? String(v.PARTYGSTIN).trim().toUpperCase() : null

    const draft: CanonicalInvoiceDraft = {
      counterpartyGstin: gstin,
      counterpartyName: v.PARTYLEDGERNAME ? String(v.PARTYLEDGERNAME).trim() : null,
      invoiceNumber: v.VOUCHERNUMBER ? String(v.VOUCHERNUMBER).trim() : null,
      invoiceDate: parseDateToIso(normalizeTallyDate(v.DATE)), // Tally DATE is YYYYMMDD
      placeOfSupply: v.PLACEOFSUPPLY ? String(v.PLACEOFSUPPLY).trim() : (gstin ? stateCodeFromGstin(gstin) : null),
      invoiceType: "b2b",
      taxableValue, cgstAmount, sgstAmount, igstAmount, cessAmount: 0, totalValue,
      items: items.length > 0
        ? items
        : [{ hsnSacCode: null, description: null, quantity: 1, rate: taxableValue, taxableValue, gstRatePercent: 0, cgstAmount, sgstAmount, igstAmount }],
    }

    return { sourceRow: idx + 1, rawData: v as Record<string, unknown>, mappedData: draft, mappingConfidence: 1, warnings }
  })

  return { rows }
}

// Tally XML's own DATE field is YYYYMMDD with no separators -- normalize
// before handing to the shared parseDateToIso (which expects separators or
// ISO already).
export function normalizeTallyDate(raw: string | undefined): string | undefined {
  if (!raw) return raw
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw
}
