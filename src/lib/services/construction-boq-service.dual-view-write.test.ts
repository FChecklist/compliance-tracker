/// <reference types="bun-types" />
// R85 Addendum 3 v4 FINAL, Phase 7 (D89) -- WRITE-PATH PROOF for the 4
// dual-view columns (qtyProject/rateProject/qtyContract/rateContract),
// distinct from construction-boq-service.dual-view-wiring.test.ts (Phase 2,
// which proves the READ path only). A real, pre-existing gap was found and
// fixed while building this phase: NOTHING in this codebase ever wrote these
// 4 columns before Phase 7 (`git grep -n "qtyProject:"` across all of src/
// found zero insert/update call sites, only type declarations and test
// fixtures) -- and the fix surfaced a SECOND, more severe latent bug:
// createBoqRevision()'s own "copy every parent line item forward unchanged"
// default path went through toLineItemInput(), which never read these 4
// columns off the previous row, so EVERY revision silently wiped them to
// NULL for every line, including lines nobody touched. Currently harmless in
// practice (nothing had written real values into these columns yet), but
// the moment any real write path -- Phase 7's own Excel apply included --
// starts using them, the very next "Create Revision" click would have
// discarded that data. This file's second describe block is the falsifiable
// proof that this is now fixed.
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

const ORG_ID = "org-1"

type FakeLineRow = {
  id: string
  boqId: string
  itemCode: string | null
  parentLineItemId: string | null
  description: string
  unit: string
  quantity: string
  rate: string
  amount: string
  breakdownPercentage: string | null
  materialCost: string | null
  labourCost: string | null
  equipmentCost: string | null
  overheadPercent: string | null
  profitPercent: string | null
  materialAmount: string | null
  manpowerAmount: string | null
  category: string | null
  qtyProject: string | null
  rateProject: string | null
  qtyContract: string | null
  rateContract: string | null
}

const LINE_ROW: FakeLineRow = {
  id: "line-1", boqId: "boq-1", itemCode: "C-01", parentLineItemId: null,
  description: "Excavation", unit: "m3", quantity: "100", rate: "50", amount: "5000",
  breakdownPercentage: null, materialCost: null, labourCost: null, equipmentCost: null,
  overheadPercent: null, profitPercent: null, materialAmount: null, manpowerAmount: null, category: null,
  qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50",
}

/**
 * Faithful enough to make BOTH createBoq's and createBoqRevision's real read-
 * after-write assertions pass (assertLineItemsPersisted, getBoqRow) without
 * a live database: `constructionBoqLineItems.findMany` is called in a FIXED,
 * KNOWN sequence by each function (traced directly from their own source
 * above), so this fake distinguishes calls by ORDER rather than attempting
 * to generically evaluate a drizzle `where` SQL object (this repo's own
 * established convention for this exact class of limitation -- see
 * boq-baseline-service.test.ts's mountFakeDb comment).
 *
 *   createBoq:          [insertedRows, insertedRows]                 (assertLineItemsPersisted, then getBoqRow)
 *   createBoqRevision:  [parentLines, insertedRows, insertedRows, insertedRows]  (previousItems, currentItems-for-the-guard, assertLineItemsPersisted, getBoqRow)
 */
function mountFakeDb(opts: {
  parentBoq?: { id: string; orgId: string; projectId: string; version: number; title: string } | null
  existingChild?: unknown
  parentLines?: FakeLineRow[]
  isRevisionFlow?: boolean
  insertedValuesCapture?: Array<Record<string, unknown>>
}) {
  const insertedValuesCapture = opts.insertedValuesCapture ?? []
  const insertedLineItemsStore: FakeLineRow[] = []
  let lineItemsFindManyCalls = 0
  // createBoqRevision makes TWO sequential constructionBoqs.findFirst calls
  // before ever inserting anything: (1) the parent, by id; (2) does a child
  // already exist, by parentBoqId (E-128's own double-submit guard). BOTH
  // createBoq and createBoqRevision then make ONE MORE such call AFTER
  // inserting, inside getBoqRow(db, <the just-created boq's own id>) --
  // that call must return the header this fake's own insert mock just
  // produced, not `parentBoq`/`existingChild` again.
  let boqFindFirstCalls = 0
  let createdBoqHeader: { id: string; orgId: string; projectId: string; version: number; title: unknown; parentBoqId: string | null; status: string } | null = null
  const fakeDb = {
    query: {
      projects: { findFirst: mock(async () => ({ id: "proj-1", orgId: ORG_ID })) },
      constructionBoqs: {
        findFirst: mock(async () => {
          boqFindFirstCalls++
          if (opts.isRevisionFlow) {
            if (boqFindFirstCalls === 1) return opts.parentBoq ?? null
            if (boqFindFirstCalls === 2) return opts.existingChild ?? null
          }
          return createdBoqHeader // getBoqRow's own post-insert lookup, both flows
        }),
      },
      constructionBoqLineItems: {
        findMany: mock(async () => {
          lineItemsFindManyCalls++
          if (opts.isRevisionFlow && lineItemsFindManyCalls === 1) return opts.parentLines ?? [LINE_ROW]
          return insertedLineItemsStore
        }),
      },
      // createBoqRevision's post-insert scope-reduction guard reads this --
      // no progress recorded against any line in these tests, so an empty
      // result is always the right, real answer (not a workaround).
      constructionWorkProgressEntries: { findMany: mock(async () => []) },
    },
    insert: mock(() => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: async (columns?: Record<string, unknown>) => {
          if (Array.isArray(values)) {
            // Line-item batch insert -- each row is stored EXACTLY as
            // insertLineItems() built it (already-stringified numerics
            // included), matching what a real Postgres round-trip returns.
            const inserted = values.map((v, i) => {
              insertedValuesCapture.push(v)
              const row = { ...LINE_ROW, ...v, id: `new-line-${insertedLineItemsStore.length + i}` } as FakeLineRow
              insertedLineItemsStore.push(row)
              return columns ? { id: row.id, itemCode: row.itemCode } : row
            })
            return inserted
          }
          // BOQ header insert.
          createdBoqHeader = { id: "boq-2", orgId: ORG_ID, projectId: "proj-1", version: (values.version as number) ?? 2, title: values.title, parentBoqId: (values.parentBoqId as string | null) ?? null, status: "draft" }
          return [createdBoqHeader]
        },
      }),
    })),
    update: mock(() => ({ set: () => ({ where: async () => [] }) })),
  }
  return { fakeDb, insertedValuesCapture }
}

async function mountAndImport(opts: Parameters<typeof mountFakeDb>[0]) {
  const { fakeDb, insertedValuesCapture } = mountFakeDb(opts)
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  const svc = await import("./construction-boq-service")
  return { svc, insertedValuesCapture }
}

describe("insertLineItems -- Phase 7 write path for qtyProject/rateProject/qtyContract/rateContract", () => {
  test("createBoq stores all four dual-view columns when a caller explicitly supplies them", async () => {
    const { svc, insertedValuesCapture } = await mountAndImport({})
    await svc.createBoq({ orgId: ORG_ID, userId: "u1" }, {
      projectId: "proj-1",
      title: "Villa 21",
      lineItems: [{ description: "Excavation", unit: "m3", quantity: 100, rate: 50, qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50 }],
    })
    expect(insertedValuesCapture.length).toBe(1)
    expect(insertedValuesCapture[0]!.qtyProject).toBe("100")
    expect(insertedValuesCapture[0]!.rateProject).toBe("40")
    expect(insertedValuesCapture[0]!.qtyContract).toBe("100")
    expect(insertedValuesCapture[0]!.rateContract).toBe("50")
  })

  test("createBoq stores NULL for these columns when a caller never supplies them (existing behaviour, unchanged)", async () => {
    const { svc, insertedValuesCapture } = await mountAndImport({})
    await svc.createBoq({ orgId: ORG_ID, userId: "u1" }, {
      projectId: "proj-1",
      title: "Villa 21",
      lineItems: [{ description: "Excavation", unit: "m3", quantity: 100, rate: 50 }],
    })
    expect(insertedValuesCapture[0]!.qtyProject).toBeNull()
    expect(insertedValuesCapture[0]!.rateProject).toBeNull()
    expect(insertedValuesCapture[0]!.qtyContract).toBeNull()
    expect(insertedValuesCapture[0]!.rateContract).toBeNull()
  })
})

describe("createBoqRevision's copy-forward default -- THE REAL BUG (found and fixed in Phase 7)", () => {
  test("a revision created with NO explicit lineItems (the common 'New Revision' case) carries qtyProject/rateProject/qtyContract/rateContract FORWARD from the parent, never silently wiping them to NULL", async () => {
    const { svc, insertedValuesCapture } = await mountAndImport({
      parentBoq: { id: "boq-1", orgId: ORG_ID, projectId: "proj-1", version: 1, title: "Villa 21" },
      existingChild: null,
      parentLines: [LINE_ROW],
      isRevisionFlow: true,
    })
    await svc.createBoqRevision({ orgId: ORG_ID, userId: "u1" }, "boq-1", {})
    expect(insertedValuesCapture.length).toBe(1)
    expect(insertedValuesCapture[0]!.qtyProject).toBe("100")
    expect(insertedValuesCapture[0]!.rateProject).toBe("40")
    expect(insertedValuesCapture[0]!.qtyContract).toBe("100")
    expect(insertedValuesCapture[0]!.rateContract).toBe("50")
  })
})
