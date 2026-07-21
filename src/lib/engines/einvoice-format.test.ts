/// <reference types="bun-types" />
// V2-1 / V2-21: the country-config e-invoice FORMAT path's test suite. The
// DONE CRITERION for the e-invoice half of V2-1 is the same shape as the tax
// engines' country-config suite -- both countries resolve through ONE
// function (buildEInvoicePayload) chosen on `organisations.country`, with no
// India hardcoding in the path. India emits the IRP JSON; UAE emits the FTA
// Peppol UBL payload. An unregistered country throws rather than silently
// falling back to India's IRP schema.
import { describe, test, expect } from "bun:test"
import { buildEInvoicePayload, resolveEinvoiceCountry } from "./einvoice-format"

const BASE = {
  invoiceNumber: "INV-001",
  postingDate: "2026-07-20",
  subtotal: 100000,
  taxAmount: 18000,
  grandTotal: 118000,
  seller: { taxId: "27ABCDE1234F1Z5", legalName: "Seller Pvt Ltd", address: "1 Market St" },
  buyer: { taxId: "07XYZAB6789G1Z1", legalName: "Buyer Pvt Ltd" },
  lines: [
    { description: "Widget", quantity: 10, rate: 10000, amount: 100000, hsnSacCode: "9983", taxRatePercent: 18, igst: 18000 },
  ],
}

describe("V2-1 e-invoice country-config FORMAT path (IN + AE resolve through buildEInvoicePayload)", () => {
  test("India routes to the IRP JSON schema (TaxSch GST, Gstin, HsnCd) with the per-line GstRt fix", () => {
    const { country, payload } = buildEInvoicePayload({ ...BASE, country: "IN" })
    expect(country).toBe("IN")
    const irp = payload as Record<string, any>
    expect(irp.TranDtls.TaxSch).toBe("GST")
    expect(irp.SellerDtls.Gstin).toBe("27ABCDE1234F1Z5")
    expect(irp.BuyerDtls.Pos).toBe("07") // buyer GSTIN state code
    // V2-21 per-line GstRt fix: no longer hardcoded 0
    expect(irp.ItemList[0].GstRt).toBe(18)
    expect(irp.ItemList[0].HsnCd).toBe("9983")
    expect(irp.ItemList[0].IgstAmt).toBe(18000)
    expect(irp.ValDtls.TotInvVal).toBe(118000)
  })

  test("UAE routes to the FTA Peppol UBL schema (Invoice envelope, TRN, AED, no HSN, no GSTIN)", () => {
    const aeInput = {
      ...BASE,
      country: "AE",
      seller: { taxId: "100123456789012", legalName: "Seller FZ-LLC", address: "Sheikh Zayed Rd" },
      buyer: { taxId: "100987654321098", legalName: "Buyer LLC" },
      lines: [{ description: "Consulting", quantity: 1, rate: 100000, amount: 100000, taxRatePercent: 5 }],
      subtotal: 100000,
      taxAmount: 5000,
      grandTotal: 105000,
    }
    const { country, payload } = buildEInvoicePayload(aeInput)
    expect(country).toBe("AE")
    const ubl = (payload as any).Invoice
    expect(ubl.DocumentCurrencyCode._).toBe("AED")
    expect(ubl.AccountingSupplierParty.Party.PartyLegalEntity.CompanyID._).toBe("100123456789012")
    expect(ubl.AccountingSupplierParty.Party.PartyLegalEntity.CompanyID.schemeID).toBe("AE:TRN")
    expect(ubl.AccountingSupplierParty.Party.PostalAddress.Country.IdentificationCode).toBe("AE")
    // UAE has no HSN -- the line carries a tax category, not a goods code
    expect(ubl.InvoiceLine[0].Item.ClassifiedTaxCategory.Percent).toBe(5)
    expect(ubl.InvoiceLine[0].Item.ClassifiedTaxCategory.ID).toBe("S") // standard-rated
    expect(ubl.InvoiceLine[0].Item.Name).toBe("Consulting")
    expect(ubl.LegalMonetaryTotal.PayableAmount._).toBe(105000)
    expect(ubl.TaxTotal.TaxAmount._).toBe(5000)
    // Crucially: no India IRP schema leaked into the UAE payload
    expect(payload).not.toHaveProperty("TranDtls")
    expect(payload).not.toHaveProperty("SellerDtls")
  })

  test("UAE zero-rated line is classified E (exempt/zero-rated), not S", () => {
    const { payload } = buildEInvoicePayload({
      ...BASE, country: "AE",
      seller: { taxId: "100123456789012", legalName: "S" }, buyer: { taxId: "100987654321098", legalName: "B" },
      lines: [{ description: "Export", quantity: 1, rate: 100000, amount: 100000, taxRatePercent: 0 }],
      subtotal: 100000, taxAmount: 0, grandTotal: 100000,
    })
    const cat = (payload as any).Invoice.InvoiceLine[0].Item.ClassifiedTaxCategory
    expect(cat.ID).toBe("E")
    expect(cat.Percent).toBe(0)
  })

  test("country routing is case-insensitive ('in' == 'IN', 'ae' == 'AE')", () => {
    expect(resolveEinvoiceCountry("in")).toBe("IN")
    expect(resolveEinvoiceCountry("AE")).toBe("AE")
    expect(resolveEinvoiceCountry("ae")).toBe("AE")
  })

  test("an unregistered country throws rather than silently emitting India's IRP schema", () => {
    expect(() => buildEInvoicePayload({ ...BASE, country: "GB" })).toThrow(/No e-invoice format registered for country: GB/)
    expect(() => resolveEinvoiceCountry("")).toThrow()
    expect(() => resolveEinvoiceCountry("   ")).toThrow()
  })
})
