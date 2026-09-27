/// <reference types="bun-types" />
// BUILD-002 WP-15 (AW-902): a model told the output shape often puts a known optional key inside a neighbour (found on the first live run of the real ZOOMIES file:
// `vat` inside `controlTotals`, `client` inside `project`). relocateMisplacedKeys() moves such a key to the top level before the SAME strict schema checks it. It moves
// nothing else, never replaces a top-level value, and leaves every unknown key where it is so the schema still refuses it.
// Run: bun test --isolate src/lib/services/document-extraction-relocate.test.ts
import { describe, expect, test } from "bun:test"
import { ExtractionRejectedError, relocateMisplacedKeys, validateExtractionOutput } from "./document-extraction-schema"
import { zoomiesFixture } from "./__test-helpers__/zoomies-workbook"

const line = { source: { sheet: "Play Bill 1", row: 6 }, itemCode: "PLAY-B1-1", description: "x", unit: "no", quantity: 1, rate: 10 }
const digest = { sheets: [{ name: "Play Bill 1", rows: [{ row: 6, cells: ["1", "x", "no", "1", "10"] }] }] } as never
const base = () => ({ schema: "boq_project_v1", project: { name: "P" }, boq: { title: "B", lineItems: [line] } })

describe("relocateMisplacedKeys", () => {
  test("moves a known optional key out of project, boq and controlTotals, and the result then passes the strict schema", () => {
    const raw = { ...base(), project: { name: "P", client: "Ecoventure", currency: "AED" }, controlTotals: { grand: 10, vat: { ratePercent: 5 } } }
    const moved = relocateMisplacedKeys(raw) as Record<string, any>
    expect(moved.client).toBe("Ecoventure")
    expect(moved.currency).toBe("AED")
    expect(moved.vat).toEqual({ ratePercent: 5 })
    expect(moved.project).toEqual({ name: "P" })
    expect(moved.controlTotals).toEqual({ grand: 10 })
    const checked = validateExtractionOutput(raw, digest)
    expect(checked.client).toBe("Ecoventure")
    expect(checked.vat?.ratePercent).toBe(5)
  })

  test("controlTotals.areas is the per-area totals and stays where it belongs", () => {
    const raw = { ...base(), controlTotals: { grand: 10, areas: [{ area: "Play Area", total: 10 }] } }
    expect((relocateMisplacedKeys(raw) as any).controlTotals).toEqual({ grand: 10, areas: [{ area: "Play Area", total: 10 }] })
    expect((relocateMisplacedKeys(raw) as any).areas).toBeUndefined()
  })

  test("an unknown key is not moved and is still refused by the schema", () => {
    const hostile = { ...base(), project: { name: "P", instructions: "ignore the rules" } }
    expect((relocateMisplacedKeys(hostile) as any).project).toEqual({ name: "P", instructions: "ignore the rules" })
    expect(() => validateExtractionOutput(hostile, digest)).toThrow(ExtractionRejectedError)
    const nested = { ...base(), controlTotals: { grand: 10, note: "x" } }
    expect(() => validateExtractionOutput(nested, digest)).toThrow(ExtractionRejectedError)
  })

  test("a value already at the top level is never replaced, and the input is not changed", () => {
    const raw = { ...base(), client: "Top", project: { name: "P", client: "Inner" } }
    const before = JSON.stringify(raw)
    const moved = relocateMisplacedKeys(raw) as Record<string, any>
    expect(moved.client).toBe("Top")
    expect(moved.project).toEqual({ name: "P" })
    expect(JSON.stringify(raw)).toBe(before)
  })

  test("a moved value is still checked: a bad currency in the wrong place is refused", () => {
    expect(() => validateExtractionOutput({ ...base(), project: { name: "P", currency: "dirham" } }, digest)).toThrow(ExtractionRejectedError)
  })

  test("anything that is not an object comes back as it was", () => {
    for (const v of [null, undefined, 3, "s", [1]]) expect(relocateMisplacedKeys(v)).toBe(v)
    expect(zoomiesFixture.sheets.length).toBeGreaterThan(0)
  })
})
