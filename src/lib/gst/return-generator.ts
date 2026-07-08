// Builds GSTR-1 and GSTR-3B JSON from confirmed gst_canonical_invoices, in
// the field-name shape GSTN's own offline tool / API uses (gstin, fp, b2b/
// b2cl/b2cs/cdnr/hsn sections for GSTR-1; 3.1/3.2/4 sections for GSTR-3B) --
// this is GSTN's own public return-filing spec, not any third party's code.
// Field abbreviations (ctin/inum/idt/txval/rt/camt/samt/iamt/csamt/pos/etc.)
// match the publicly documented GSTR-1 JSON schema so the output is
// structurally familiar to anyone who has used the official offline tool;
// treat this as "ready to review and reconcile against the portal's own
// validation, not a verified byte-for-byte upload contract" -- real upload
// compatibility should be confirmed against the live offline tool before
// filing, matching this codebase's existing e-invoice honesty precedent
// (erp-invoicing-service.ts's e-invoice payload has the same caveat).
import Decimal from "decimal.js"

export type ReturnInvoiceItem = { hsnSacCode: string | null; description: string | null; quantity: string | number; taxableValue: string | number; gstRatePercent: string | number; cgstAmount: string | number; sgstAmount: string | number; igstAmount: string | number }
export type ReturnInvoice = {
  counterpartyGstin: string | null
  invoiceNumber: string
  invoiceDate: string // ISO
  placeOfSupply: string | null
  invoiceType: string // b2b | b2cl | b2cs | cdnr | exports | sez
  taxableValue: string | number
  cgstAmount: string | number
  sgstAmount: string | number
  igstAmount: string | number
  cessAmount: string | number
  totalValue: string | number
  items: ReturnInvoiceItem[]
}

const num = (v: string | number) => (typeof v === "number" ? v : parseFloat(v) || 0)
const ddmmyyyy = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}` }

function buildB2b(invoices: ReturnInvoice[]) {
  const byGstin = new Map<string, ReturnInvoice[]>()
  for (const inv of invoices.filter(i => i.invoiceType === "b2b" && i.counterpartyGstin)) {
    const g = inv.counterpartyGstin!
    if (!byGstin.has(g)) byGstin.set(g, [])
    byGstin.get(g)!.push(inv)
  }
  return Array.from(byGstin.entries()).map(([ctin, invs]) => ({
    ctin,
    inv: invs.map(inv => ({
      inum: inv.invoiceNumber,
      idt: ddmmyyyy(inv.invoiceDate),
      val: num(inv.totalValue),
      pos: inv.placeOfSupply ?? "",
      rchrg: "N",
      inv_typ: "R",
      itms: inv.items.map((item, idx) => ({
        num: idx + 1,
        itm_det: {
          txval: num(item.taxableValue),
          rt: num(item.gstRatePercent),
          camt: num(item.cgstAmount),
          samt: num(item.sgstAmount),
          iamt: num(item.igstAmount),
          csamt: 0,
        },
      })),
    })),
  }))
}

function buildB2cl(invoices: ReturnInvoice[]) {
  // B2C Large: unregistered buyer, inter-state, invoice value > 1 lakh
  const byPos = new Map<string, ReturnInvoice[]>()
  for (const inv of invoices.filter(i => i.invoiceType === "b2cl")) {
    const pos = inv.placeOfSupply ?? "00"
    if (!byPos.has(pos)) byPos.set(pos, [])
    byPos.get(pos)!.push(inv)
  }
  return Array.from(byPos.entries()).map(([pos, invs]) => ({
    pos,
    inv: invs.map(inv => ({
      inum: inv.invoiceNumber, idt: ddmmyyyy(inv.invoiceDate), val: num(inv.totalValue),
      itms: inv.items.map((item, idx) => ({ num: idx + 1, itm_det: { txval: num(item.taxableValue), rt: num(item.gstRatePercent), iamt: num(item.igstAmount), csamt: 0 } })),
    })),
  }))
}

function buildB2cs(invoices: ReturnInvoice[]) {
  // B2C Small: aggregated by rate + place of supply, not invoice-wise
  const groups = new Map<string, { pos: string; rt: number; txval: Decimal; camt: Decimal; samt: Decimal; iamt: Decimal }>()
  for (const inv of invoices.filter(i => i.invoiceType === "b2cs")) {
    for (const item of inv.items) {
      const key = `${inv.placeOfSupply ?? "00"}|${num(item.gstRatePercent)}`
      const g = groups.get(key) ?? { pos: inv.placeOfSupply ?? "00", rt: num(item.gstRatePercent), txval: new Decimal(0), camt: new Decimal(0), samt: new Decimal(0), iamt: new Decimal(0) }
      g.txval = g.txval.plus(num(item.taxableValue)); g.camt = g.camt.plus(num(item.cgstAmount)); g.samt = g.samt.plus(num(item.sgstAmount)); g.iamt = g.iamt.plus(num(item.igstAmount))
      groups.set(key, g)
    }
  }
  return Array.from(groups.values()).map(g => ({ pos: g.pos, rt: g.rt, typ: "OE", txval: g.txval.toNumber(), camt: g.camt.toNumber(), samt: g.samt.toNumber(), iamt: g.iamt.toNumber(), csamt: 0 }))
}

function buildCdnr(invoices: ReturnInvoice[]) {
  const byGstin = new Map<string, ReturnInvoice[]>()
  for (const inv of invoices.filter(i => i.invoiceType === "cdnr" && i.counterpartyGstin)) {
    const g = inv.counterpartyGstin!
    if (!byGstin.has(g)) byGstin.set(g, [])
    byGstin.get(g)!.push(inv)
  }
  return Array.from(byGstin.entries()).map(([ctin, invs]) => ({
    ctin,
    nt: invs.map(inv => ({
      ntty: "C", nt_num: inv.invoiceNumber, nt_dt: ddmmyyyy(inv.invoiceDate), val: num(inv.totalValue),
      itms: inv.items.map((item, idx) => ({ num: idx + 1, itm_det: { txval: num(item.taxableValue), rt: num(item.gstRatePercent), camt: num(item.cgstAmount), samt: num(item.sgstAmount), iamt: num(item.igstAmount), csamt: 0 } })),
    })),
  }))
}

function buildHsnSummary(invoices: ReturnInvoice[]) {
  const groups = new Map<string, { hsn_sc: string; desc: string; uqc: string; qty: Decimal; txval: Decimal; camt: Decimal; samt: Decimal; iamt: Decimal; rt: number }>()
  let num_ = 0
  for (const inv of invoices) {
    for (const item of inv.items) {
      const hsn = item.hsnSacCode ?? "UNKNOWN"
      const key = `${hsn}|${num(item.gstRatePercent)}`
      const g = groups.get(key) ?? { hsn_sc: hsn, desc: item.description ?? "", uqc: "NOS", qty: new Decimal(0), txval: new Decimal(0), camt: new Decimal(0), samt: new Decimal(0), iamt: new Decimal(0), rt: num(item.gstRatePercent) }
      g.qty = g.qty.plus(num(item.quantity)); g.txval = g.txval.plus(num(item.taxableValue)); g.camt = g.camt.plus(num(item.cgstAmount)); g.samt = g.samt.plus(num(item.sgstAmount)); g.iamt = g.iamt.plus(num(item.igstAmount))
      groups.set(key, g)
    }
  }
  return Array.from(groups.values()).map(g => ({ num: ++num_, hsn_sc: g.hsn_sc, desc: g.desc, uqc: g.uqc, qty: g.qty.toNumber(), val: g.txval.plus(g.camt).plus(g.samt).plus(g.iamt).toNumber(), txval: g.txval.toNumber(), rt: g.rt, camt: g.camt.toNumber(), samt: g.samt.toNumber(), iamt: g.iamt.toNumber(), csamt: 0 }))
}

export function generateGstr1(gstin: string, period: string /* YYYY-MM */, salesInvoices: ReturnInvoice[]) {
  const fp = `${period.slice(5, 7)}${period.slice(0, 4)}` // MMYYYY
  const json = {
    gstin, fp, version: "GST3.2.4",
    b2b: buildB2b(salesInvoices),
    b2cl: buildB2cl(salesInvoices),
    b2cs: buildB2cs(salesInvoices),
    cdnr: buildCdnr(salesInvoices),
    hsn: { data: buildHsnSummary(salesInvoices) },
  }
  const totals = salesInvoices.reduce((acc, inv) => ({
    taxableValue: acc.taxableValue.plus(num(inv.taxableValue)),
    cgst: acc.cgst.plus(num(inv.cgstAmount)), sgst: acc.sgst.plus(num(inv.sgstAmount)), igst: acc.igst.plus(num(inv.igstAmount)),
    totalValue: acc.totalValue.plus(num(inv.totalValue)),
  }), { taxableValue: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0), totalValue: new Decimal(0) })
  const summary = {
    invoiceCount: salesInvoices.length,
    taxableValue: totals.taxableValue.toNumber(), cgst: totals.cgst.toNumber(), sgst: totals.sgst.toNumber(), igst: totals.igst.toNumber(),
    totalValue: totals.totalValue.toNumber(),
    bySection: { b2b: json.b2b.length, b2cl: json.b2cl.length, b2cs: json.b2cs.length, cdnr: json.cdnr.length, hsnLines: json.hsn.data.length },
  }
  return { json, summary }
}

export function generateGstr3b(gstin: string, period: string, salesInvoices: ReturnInvoice[], purchaseInvoices: ReturnInvoice[]) {
  const sumBy = (invoices: ReturnInvoice[], field: "taxableValue" | "cgstAmount" | "sgstAmount" | "igstAmount") =>
    invoices.reduce((s, inv) => s.plus(num(inv[field])), new Decimal(0))

  const outwardTaxable = sumBy(salesInvoices, "taxableValue")
  const outwardCgst = sumBy(salesInvoices, "cgstAmount"), outwardSgst = sumBy(salesInvoices, "sgstAmount"), outwardIgst = sumBy(salesInvoices, "igstAmount")
  const itcCgst = sumBy(purchaseInvoices, "cgstAmount"), itcSgst = sumBy(purchaseInvoices, "sgstAmount"), itcIgst = sumBy(purchaseInvoices, "igstAmount")
  const fp = `${period.slice(5, 7)}${period.slice(0, 4)}`

  const json = {
    gstin, ret_period: fp,
    sup_details: { // 3.1 Outward supplies
      osup_det: { txval: outwardTaxable.toNumber(), camt: outwardCgst.toNumber(), samt: outwardSgst.toNumber(), iamt: outwardIgst.toNumber(), csamt: 0 },
    },
    itc_elg: { // 4 Eligible ITC
      itc_avl: [{ ty: "IMPG", camt: 0, samt: 0, iamt: 0, csamt: 0 }, { ty: "ISRC", camt: 0, samt: 0, iamt: 0, csamt: 0 },
        { ty: "ISD", camt: 0, samt: 0, iamt: 0, csamt: 0 }, { ty: "OTH", camt: itcCgst.toNumber(), samt: itcSgst.toNumber(), iamt: itcIgst.toNumber(), csamt: 0 }],
    },
  }
  const netCgst = outwardCgst.minus(itcCgst), netSgst = outwardSgst.minus(itcSgst), netIgst = outwardIgst.minus(itcIgst)
  const summary = {
    outwardTaxableValue: outwardTaxable.toNumber(), outwardTax: outwardCgst.plus(outwardSgst).plus(outwardIgst).toNumber(),
    eligibleItc: itcCgst.plus(itcSgst).plus(itcIgst).toNumber(),
    netTaxPayable: { cgst: Decimal.max(netCgst, 0).toNumber(), sgst: Decimal.max(netSgst, 0).toNumber(), igst: Decimal.max(netIgst, 0).toNumber() },
  }
  return { json, summary }
}
