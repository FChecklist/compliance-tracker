// E43_PARSEAMOUNT_SILENT_ZERO_GST_IMPORT_PATH. Same silent-zero problem as
// spreadsheet-adapter.ts, extended to the Tally XML import path: a
// hand-edited/corrupted Tally export's LEDGERNAME AMOUNT (or an inventory
// entry's ACTUALQTY/RATE/AMOUNT) could hold non-numeric text and
// parseAmount() would silently coerce it to 0 with no report anywhere.
/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { adaptTallyXml } from "./tally-xml-adapter"

function voucherXml(ledgerAmount: string, extra = ""): string {
  return `<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER>
    <DATE>20260701</DATE>
    <VOUCHERNUMBER>INV-100</VOUCHERNUMBER>
    <PARTYLEDGERNAME>Acme Traders</PARTYLEDGERNAME>
    <PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Sales Account</LEDGERNAME>
      <ISPARTYLEDGER>No</ISPARTYLEDGER>
      <AMOUNT>${ledgerAmount}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    ${extra}
  </VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`
}

describe("adaptTallyXml -- E-43 malformed AMOUNT/RATE/QTY cells are flagged, not silently zeroed", () => {
  test("a genuinely-numeric ledger AMOUNT produces zero warnings", () => {
    const { rows } = adaptTallyXml(voucherXml("10000"))
    expect(rows).toHaveLength(1)
    expect(rows[0].warnings).toHaveLength(0)
    expect(rows[0].mappedData.taxableValue).toBe(10000)
  })

  test("a malformed ledger AMOUNT is flagged in warnings AND still parses to 0", () => {
    const { rows } = adaptTallyXml(voucherXml("not-a-number"))
    expect(rows[0].mappedData.taxableValue).toBe(0)
    expect(rows[0].warnings.length).toBeGreaterThan(0)
    expect(rows[0].warnings.some(w => w.includes("Sales Account") && w.includes("not-a-number"))).toBe(true)
  })

  test("a malformed inventory RATE is flagged, distinct from a malformed AMOUNT", () => {
    const extra = `<INVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Widget</STOCKITEMNAME>
      <ACTUALQTY>5</ACTUALQTY>
      <RATE>garbage-rate</RATE>
      <AMOUNT>500</AMOUNT>
    </INVENTORYENTRIES.LIST>`
    const { rows } = adaptTallyXml(voucherXml("10000", extra))
    expect(rows[0].mappedData.items[0].rate).toBe(0)
    expect(rows[0].warnings.some(w => w.includes("Widget") && w.includes("rate") && w.includes("garbage-rate"))).toBe(true)
  })

  test("a malformed inventory AMOUNT that falls back into taxableValue is only warned about once", () => {
    // No non-party ledger line -- taxableValue derives entirely from the
    // inventory entry's own (malformed) AMOUNT.
    const xml = `<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER>
      <DATE>20260701</DATE>
      <VOUCHERNUMBER>INV-101</VOUCHERNUMBER>
      <PARTYLEDGERNAME>Acme Traders</PARTYLEDGERNAME>
      <INVENTORYENTRIES.LIST>
        <STOCKITEMNAME>Widget</STOCKITEMNAME>
        <ACTUALQTY>5</ACTUALQTY>
        <RATE>100</RATE>
        <AMOUNT>bad-amount</AMOUNT>
      </INVENTORYENTRIES.LIST>
    </VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`
    const { rows } = adaptTallyXml(xml)
    expect(rows[0].mappedData.taxableValue).toBe(0)
    const amountWarnings = rows[0].warnings.filter(w => w.includes("bad-amount"))
    expect(amountWarnings).toHaveLength(1)
  })
})
