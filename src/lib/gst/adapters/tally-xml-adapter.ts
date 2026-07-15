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
import { parseAmount, parseDateToIso } from "@/lib/gst/column-mapper"
import type { CanonicalInvoiceDraft, StagedRow } from "@/lib/gst/canonical-types"
import { stateCodeFromGstin } from "@/lib/engines/in/gst-engine"

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

    let taxableValue = 0, cgstAmount = 0, sgstAmount = 0, igstAmount = 0
    for (const entry of ledgerEntries) {
      const amount = Math.abs(parseAmount(entry.AMOUNT))
      const kind = classifyLedger(entry.LEDGERNAME ?? "")
      if (kind === "cgst") cgstAmount += amount
      else if (kind === "sgst") sgstAmount += amount
      else if (kind === "igst") igstAmount += amount
      else if (entry.ISPARTYLEDGER !== "Yes") taxableValue += amount // non-party, non-tax ledger -- treat as the sale/purchase value line
    }
    // Fallback: if no non-tax ledger line was found, derive taxable value from inventory entries
    if (taxableValue === 0 && inventoryEntries.length > 0) {
      taxableValue = inventoryEntries.reduce((sum, e) => sum + Math.abs(parseAmount(e.AMOUNT)), 0)
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
      items: inventoryEntries.length > 0
        ? inventoryEntries.map(e => ({
            hsnSacCode: e.HSNCODE ? String(e.HSNCODE).trim() : null,
            description: e.STOCKITEMNAME ? String(e.STOCKITEMNAME).trim() : null,
            quantity: parseAmount(e.ACTUALQTY) || 1,
            rate: parseAmount(e.RATE),
            taxableValue: Math.abs(parseAmount(e.AMOUNT)),
            gstRatePercent: 0,
            cgstAmount: 0, sgstAmount: 0, igstAmount: 0,
          }))
        : [{ hsnSacCode: null, description: null, quantity: 1, rate: taxableValue, taxableValue, gstRatePercent: 0, cgstAmount, sgstAmount, igstAmount }],
    }

    return { sourceRow: idx + 1, rawData: v as Record<string, unknown>, mappedData: draft, mappingConfidence: 1 }
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
