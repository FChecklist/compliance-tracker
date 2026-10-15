/// <reference types="bun-types" />
// The revise form gives a line saved without an item code an invented one, `_row_<id>`. The first fix (construction-boq-service.synthetic-row-code.test.ts)
// made the diff understand it; this file covers the other half found live on 2026-10-13: the revision STORED the invented code, so the BOQ screen and
// every report showed "_row_n1kfvedqrevl6pt3svhnwlqg" as the line's Item code. The invented code only has to survive the form's round trip (so a parent
// link between two uncoded lines resolves while the revision is inserted); it must never reach the database. A real item code is stored as typed.
import { describe, test, expect } from "bun:test"
import { insertLineItems, type BoqLineItemInput } from "./construction-boq-service"

type Row = Record<string, unknown>

function fakeDb() {
  const inserted: Row[] = []
  let n = 0
  const db = {
    insert: () => ({
      values: (rows: Row[]) => ({
        returning: async () =>
          rows.map((r) => {
            inserted.push(r)
            return { id: `row${++n}`, itemCode: r.itemCode ?? null }
          }),
      }),
    }),
  }
  return { db: db as never, inserted }
}

const line = (over: Partial<BoqLineItemInput>): BoqLineItemInput => ({ description: "Blockwork", unit: "sqm", quantity: 100, rate: 50, ...over })

describe("insertLineItems -- an invented _row_ code is used for linking and never stored", () => {
  test("a plain uncoded line keeps NO item code", async () => {
    const { db, inserted } = fakeDb()
    await insertLineItems(db, "org1", "boq1", [line({ itemCode: "_row_aw0wynqx3448vfbem18jgwyy" })])
    expect(inserted).toHaveLength(1)
    expect(inserted[0].itemCode).toBeNull()
  })

  test("a de-duplicated invented code (_row_<id>_x) is not stored either", async () => {
    const { db, inserted } = fakeDb()
    await insertLineItems(db, "org1", "boq1", [line({ itemCode: "_row_aw0wynqx3448vfbem18jgwyy_x" })])
    expect(inserted[0].itemCode).toBeNull()
  })

  test("a REAL item code is stored exactly as given", async () => {
    const { db, inserted } = fakeDb()
    await insertLineItems(db, "org1", "boq1", [line({ itemCode: "A1" })])
    expect(inserted[0].itemCode).toBe("A1")
  })

  test("a parent/child link between two uncoded lines still resolves, and neither invented code is stored", async () => {
    const { db, inserted } = fakeDb()
    await insertLineItems(db, "org1", "boq1", [
      line({ itemCode: "_row_parentrow" }),
      line({ description: "Plastering", itemCode: "_row_childrow", parentItemCode: "_row_parentrow", breakdownPercentage: 30 }),
    ])
    expect(inserted).toHaveLength(2)
    expect(inserted[0].itemCode).toBeNull()
    expect(inserted[1].itemCode).toBeNull()
    expect(inserted[0].parentLineItemId).toBeNull()
    expect(inserted[1].parentLineItemId).toBe("row1")
    // the child's quantity and rate still come from the root (QTY_root, RATE_root x 30%)
    expect(inserted[1].quantity).toBe("100")
    expect(inserted[1].rate).toBe("15")
  })

  test("a real code and an invented code can link in one revision", async () => {
    const { db, inserted } = fakeDb()
    await insertLineItems(db, "org1", "boq1", [
      line({ itemCode: "A1" }),
      line({ description: "Plastering", itemCode: "_row_childrow", parentItemCode: "A1", breakdownPercentage: 30 }),
    ])
    expect(inserted[0].itemCode).toBe("A1")
    expect(inserted[1].itemCode).toBeNull()
    expect(inserted[1].parentLineItemId).toBe("row1")
  })
})
