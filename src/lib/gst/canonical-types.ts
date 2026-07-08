// Shared shape every source adapter (Excel/CSV/Tally/Busy/Zoho Books) must
// produce, so the validation/reconciliation/return-generation engines never
// need to know which accounting software a row came from.
export type CanonicalInvoiceDraft = {
  counterpartyGstin: string | null
  counterpartyName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null // ISO yyyy-mm-dd
  placeOfSupply: string | null // 2-digit GST state code
  invoiceType: string // b2b | b2cl | b2cs | cdnr | exports | sez
  taxableValue: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  cessAmount: number
  totalValue: number
  items: CanonicalInvoiceItemDraft[]
}

export type CanonicalInvoiceItemDraft = {
  hsnSacCode: string | null
  description: string | null
  quantity: number
  rate: number
  taxableValue: number
  gstRatePercent: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
}

export type StagedRow = {
  sourceRow: number
  rawData: Record<string, unknown>
  mappedData: CanonicalInvoiceDraft
  mappingConfidence: number
}
