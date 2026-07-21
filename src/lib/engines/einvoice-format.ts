// V2-1 / V2-21 (UAE country pack + e-invoicing per-line GstRt fix,
// 2026-07-20): country-config e-invoice FORMAT resolver. The DB service
// (erp-einvoice-service.ts) used to build India's IRP JSON inline with the
// tax scheme, GSTIN, and per-line `GstRt: 0` hardcoded -- so an org whose
// `organisations.country` is "AE" still got an India-shaped payload, and
// every line carried a 0% rate even when the invoice was taxed. This module
// is the country-config abstraction for that: a pure function that takes the
// invoice/org/customer/line data and the org's country code and returns the
// correct government e-invoice JSON for THAT country. The DB service stays a
// thin loader; this is where the format lives.
//
// Pure + country-routed (not a boolean flag on one builder): the UAE FTA
// e-invoice schema (Peppol BIS Billing 3.0 UBL, the FTA's adopted standard)
// is a genuinely different shape from India's IRP JSON -- UBL element names
// (Invoice/AccountingSupplierParty/Party), UNTDID code lists, a TRN (not
// GSTIN), no HSN, a tax category on each line. Forcing both through one
// builder with if/else branches would repeat the same mistake the engines
// avoided (see compliance-engine-registry.ts's own rationale for per-country
// module files). Two builders + a resolver is the right shape.
//
// Per-line GstRt fix (V2-21's code half): the IRP schema requires a real
// rate per line item, not 0. The rate isn't on erp_sales_invoice_items (no
// per-line rate column -- adding one is V2-21's Tier2 schema half, deferred
// for Owner sign-off). It IS derivable from the line's tax template
// (erpTaxTemplateItems.rate, linked via taxTemplateId) -- this resolver takes
// the resolved per-line rate as an input, and the DB service looks it up. A
// line with no tax template resolves to 0 (genuinely zero-rated / exempt),
// not a fabricated guess.
//
// No live government submission here -- this is payload generation only,
// same verification boundary as the engines. Real IRP/FTA submission needs
// GSP / FTA-portal credentials this environment doesn't have (see V2-21's
// deferred half and erp-einvoice-service.ts's own header comment).

export type EinvoiceCountry = "IN" | "AE"

export type EinvoiceLineInput = {
  description: string
  quantity: number
  rate: number
  amount: number
  // India-only: HSN/SAC code snapshotted on the line (Wave 65). UAE has no
  // equivalent classification code in its e-invoice schema -- omitted for AE.
  hsnSacCode?: string
  // The per-line tax rate PERCENT (e.g. 18 for 18% GST, 5 for 5% UAE VAT),
  // resolved by the DB service from the line's tax template before calling.
  // 0 means genuinely zero-rated/exempt, NOT "unknown" -- see V2-21 comment.
  taxRatePercent: number
  // India intra-state vs inter-state split of the line tax (CGST+SGST vs
  // IGST). Only meaningful for IN; UAE has one national rate, no split.
  cgst?: number
  sgst?: number
  igst?: number
}

export type EinvoicePayloadInput = {
  country: string
  invoiceNumber: string
  postingDate: string
  subtotal: number
  taxAmount: number
  grandTotal: number
  // Seller / buyer identifiers are country-specific (GSTIN for India, TRN for
  // UAE). The DB service reads whichever the org/customer actually has and
  // passes it here as a plain string -- this resolver does not assume which.
  seller: { taxId: string; legalName: string; address?: string }
  buyer: { taxId: string; legalName: string; address?: string }
  // India: the 2-digit state code derived from the buyer's GSTIN (place of
  // supply). UAE: unused (single tax territory, no state code).
  buyerStateCode?: string
  lines: EinvoiceLineInput[]
}

export type EinvoiceFormatResult = {
  country: EinvoiceCountry
  // Opaque government-schema JSON. Typed as a plain record so each builder
  // emits its own real schema shape (UBL vs IRP) without a forced union.
  payload: Record<string, unknown>
}

/** Resolve the country for e-invoice formatting (case-insensitive, throws on unregistered). */
export function resolveEinvoiceCountry(country: string): EinvoiceCountry {
  const key = (country ?? "").trim().toUpperCase()
  if (key === "IN") return "IN"
  if (key === "AE") return "AE"
  throw new Error(
    `No e-invoice format registered for country: ${country} — registered countries are: IN, AE`
  )
}

/**
 * Build the government e-invoice JSON for the invoice's country. Routes on
 * `organisations.country` (via the input's `country`), NOT a hardcoded India
 * path. Both countries resolve through this same function -- the V2-1 "same
 * country-config path, no India hardcoding" guarantee, applied to e-invoicing.
 */
export function buildEInvoicePayload(input: EinvoicePayloadInput): EinvoiceFormatResult {
  const country = resolveEinvoiceCountry(input.country)
  const payload =
    country === "AE" ? buildAeFtaPayload(input) : buildInIrpPayload(input)
  return { country, payload }
}

/**
 * India IRP e-invoice JSON (NIC schema v1.1) -- the same shape
 * erp-einvoice-service.ts built inline before, now extracted here so the
 * service is country-agnostic. The per-line GstRt now carries the resolved
 * tax-template rate (V2-21 fix) instead of the hardcoded 0.
 */
function buildInIrpPayload(input: EinvoicePayloadInput): Record<string, unknown> {
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B" },
    DocDtls: { Typ: "INV", No: String(input.invoiceNumber), Dt: input.postingDate },
    SellerDtls: { Gstin: input.seller.taxId, LglNm: input.seller.legalName, Addr1: input.seller.address ?? "" },
    BuyerDtls: { Gstin: input.buyer.taxId, LglNm: input.buyer.legalName, Pos: input.buyerStateCode ?? input.buyer.taxId.slice(0, 2) },
    ItemList: input.lines.map((item, i) => ({
      SlNo: String(i + 1),
      HsnCd: item.hsnSacCode ?? "",
      Qty: Number(item.quantity),
      Unit: "NOS",
      UnitPrice: Number(item.rate),
      TotAmt: Number(item.amount),
      AssAmt: Number(item.amount),
      GstRt: Number(item.taxRatePercent), // V2-21: real per-line rate, no longer hardcoded 0
      IgstAmt: Number(item.igst ?? 0),
      CgstAmt: Number(item.cgst ?? 0),
      SgstAmt: Number(item.sgst ?? 0),
      TotItemVal: Number(item.amount) + Number(item.igst ?? 0) + Number(item.cgst ?? 0) + Number(item.sgst ?? 0),
    })),
    ValDtls: { AssVal: Number(input.subtotal), TotInvVal: Number(input.grandTotal), OthChrg: Number(input.taxAmount) },
  }
}

/**
 * UAE FTA e-invoice JSON (Peppol BIS Billing 3.0 UBL, the FTA's adopted
 * standard for the UAE's phased e-invoicing rollout). Structurally distinct
 * from India's IRP JSON: UBL element names, a TRN (not GSTIN), tax category
 * per line, no HSN, ISO currency code, UNTDID code lists. This is the format
 * scaffolding V2-1/V2-21 name -- real FTA-portal submission is the gated,
 * creds-blocked half (deferred per V2-21), payload generation is the code half.
 *
 * UBL is verbose by design; the structure below follows the BIS 3.0 invoice
 * envelope (CBC/ACB/CAC namespace-agnostic tag names this codebase emits as a
 * flat object). Verify against the FTA's current Peppol profile before a live
 * submission -- BIS profiles are versioned and the FTA may scope additions.
 */
function buildAeFtaPayload(input: EinvoicePayloadInput): Record<string, unknown> {
  // UAE uses a single national VAT rate with no CGST/SGST/IGST split; the
  // line's taxRatePercent IS the VAT rate (5 standard, 0 zero-rated/exempt).
  const taxLines = input.lines.map((line) => ({
    // UBL InvoiceLine
    ID: { _: String(input.lines.indexOf(line) + 1) },
    InvoicedQuantity: { _: Number(line.quantity), unitCode: "C62" }, // UNTDID unit: pieces
    LineExtensionAmount: { _: Number(line.amount), currencyID: "AED" },
    Item: {
      Name: line.description,
      ClassifiedTaxCategory: {
        ID: line.taxRatePercent === 0 ? "E" : "S", // UNTDID 5305: E=exempt/zero-rated, S=standard-rated
        Percent: Number(line.taxRatePercent),
        TaxScheme: { ID: "VAT" },
      },
    },
    Price: { PriceAmount: { _: Number(line.rate), currencyID: "AED" } },
  }))

  // UBL allows one TaxTotal; the FTA profile expects it at document level.
  const totalVat = input.lines.reduce((sum, l) => sum + (Number(l.amount) * Number(l.taxRatePercent)) / 100, 0)

  return {
    // UBL Invoice document envelope
    Invoice: {
      ID: { _: String(input.invoiceNumber) },
      IssueDate: { _: input.postingDate },
      InvoiceTypeCode: { _: "380", listID: "UNCL1001" }, // 380 = commercial invoice
      DocumentCurrencyCode: { _: "AED" },
      TaxCurrencyCode: { _: "AED" },
      AccountingSupplierParty: {
        Party: {
          // UBL: schemeID is an attribute ON CompanyID (the identifier's scheme),
          // not a sibling of it -- the TRN is the value, "AE:TRN" names its scheme.
          PartyLegalEntity: { CompanyID: { _: input.seller.taxId, schemeID: "AE:TRN" } }, // UAE TRN, not GSTIN
          PartyName: { Name: { _: input.seller.legalName } },
          PostalAddress: { ...(input.seller.address ? { StreetName: { _: input.seller.address } } : {}), Country: { IdentificationCode: "AE" } },
        },
      },
      AccountingCustomerParty: {
        Party: {
          PartyLegalEntity: { CompanyID: { _: input.buyer.taxId, schemeID: "AE:TRN" } },
          PartyName: { Name: { _: input.buyer.legalName } },
          PostalAddress: { ...(input.buyer.address ? { StreetName: { _: input.buyer.address } } : {}), Country: { IdentificationCode: "AE" } },
        },
      },
      TaxTotal: {
        TaxAmount: { _: round2(totalVat), currencyID: "AED" },
        TaxSubtotal: {
          TaxableAmount: { _: Number(input.subtotal), currencyID: "AED" },
          TaxAmount: { _: round2(totalVat), currencyID: "AED" },
          TaxCategory: { ID: "S", Percent: 5, TaxScheme: { ID: "VAT" } },
        },
      },
      LegalMonetaryTotal: {
        LineExtensionAmount: { _: Number(input.subtotal), currencyID: "AED" },
        TaxExclusiveAmount: { _: Number(input.subtotal), currencyID: "AED" },
        TaxInclusiveAmount: { _: Number(input.grandTotal), currencyID: "AED" },
        PayableAmount: { _: Number(input.grandTotal), currencyID: "AED" },
      },
      InvoiceLine: taxLines,
    },
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
