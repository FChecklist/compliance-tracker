/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 2 (gates 2-01/2-02/2-04) -- THE GRID'S OWN WRITE
// PATH. construction-boq-service.dual-view-write.test.ts (Phase 7) proved
// the four dual-view columns (qtyProject/rateProject/qtyContract/
// rateContract) could be set at CREATE time; nothing in this codebase could
// ever EDIT them on an existing line item until updateLineItemMoneyFields()
// (this file's subject) -- a grid that cannot save an edited cell is not a
// grid. This file proves, independent of a live database:
//   2-01/A8  project-side columns are always writable, never gated
//   2-02     contract-side columns are REFUSED (409, with a real reason)
//            once the BOQ has a confirmed baseline, and remain writable
//            before one exists
//   2-04     negative qty REFUSED (400); negative rate accepted with no
//            error (a credit line is legitimate, A4); non-numeric REFUSED
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

const ORG_ID = "org-1"
const LINE_ID = "line-1"
const BOQ_ID = "boq-1"

type FakeBaselineRow = {
  id: string
  boqId: string
  version: number
  confirmedById: string
  confirmedAt: Date
  evidenceArtefactRef: string
  lineSnapshot: unknown[]
  createdAt: Date
}

/**
 * Faithful to the real call sequence traced directly from
 * updateLineItemMoneyFields()'s own source: constructionBoqLineItems
 * .findFirst (the line), constructionBoqs.findFirst (its BOQ, org-scoped),
 * then -- ONLY when a contract-side field is present in the input --
 * boqBaseline.findMany (via listBaselineVersionsWithDb). Same
 * order-distinguishing-fake convention this file's sibling tests and
 * boq-baseline-service.test.ts already use for the same documented reason
 * (a drizzle `where` SQL object cannot be generically evaluated here).
 */
function mountFakeDb(opts: { baselines?: FakeBaselineRow[] }) {
  const updateCalls: Array<Record<string, unknown>> = []
  const fakeDb = {
    query: {
      constructionBoqLineItems: {
        findFirst: mock(async () => ({ id: LINE_ID, boqId: BOQ_ID })),
      },
      constructionBoqs: {
        findFirst: mock(async () => ({ id: BOQ_ID, orgId: ORG_ID })),
      },
      boqBaseline: {
        findMany: mock(async () => opts.baselines ?? []),
      },
    },
    update: mock(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updateCalls.push(values)
            return [{
              id: LINE_ID, boqId: BOQ_ID, itemCode: "C-01", parentLineItemId: null,
              description: "Excavation", unit: "m3", quantity: "100", rate: "50", amount: "5000",
              breakdownPercentage: null, materialCost: null, labourCost: null, equipmentCost: null,
              overheadPercent: null, profitPercent: null, materialAmount: null, manpowerAmount: null,
              category: null, vendorId: null, vendorAmount: null,
              qtyProject: null, rateProject: null, qtyContract: null, rateContract: null,
              ...values,
            }]
          },
        }),
      }),
    })),
  }
  return { fakeDb, updateCalls }
}

async function mountAndImport(opts: { baselines?: FakeBaselineRow[] }) {
  const { fakeDb, updateCalls } = mountFakeDb(opts)
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  const svc = await import("./construction-boq-service")
  return { svc, updateCalls }
}

describe("updateLineItemMoneyFields -- 2-01/A8: project side is always writable", () => {
  test("writes qtyProject/rateProject with no baseline check at all, even when confirmed baselines exist", async () => {
    const confirmedAt = new Date("2026-08-14T00:00:00Z")
    const { svc, updateCalls } = await mountAndImport({
      baselines: [{ id: "b1", boqId: BOQ_ID, version: 1, confirmedById: "u1", confirmedAt, evidenceArtefactRef: "PO-1", lineSnapshot: [], createdAt: confirmedAt }],
    })
    const result = await svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyProject: 120, rateProject: 42 })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]!.qtyProject).toBe("120")
    expect(updateCalls[0]!.rateProject).toBe("42")
    expect(result.qtyProject).toBe("120")
  })

  test("clearing a project-side cell (empty/null) is accepted -- becomes NOT_SET, not refused", async () => {
    const { svc, updateCalls } = await mountAndImport({})
    await svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { rateProject: null })
    expect(updateCalls[0]!.rateProject).toBeNull()
  })
})

describe("updateLineItemMoneyFields -- 2-02: contract side locks once a baseline is confirmed", () => {
  test("qtyContract/rateContract are refused (409, real reason naming the baseline) once a baseline exists", async () => {
    const confirmedAt = new Date("2026-08-14T00:00:00Z")
    const { svc, updateCalls } = await mountAndImport({
      baselines: [{ id: "b1", boqId: BOQ_ID, version: 1, confirmedById: "u1", confirmedAt, evidenceArtefactRef: "PO-1", lineSnapshot: [], createdAt: confirmedAt }],
    })
    await expect(svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyContract: 90 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("baseline v1"),
    })
    expect(updateCalls.length).toBe(0) // refused BEFORE any write, not a silent no-op after
  })

  test("qtyContract/rateContract remain freely writable before any baseline is confirmed", async () => {
    const { svc, updateCalls } = await mountAndImport({ baselines: [] })
    await svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyContract: 90, rateContract: 55 })
    expect(updateCalls[0]!.qtyContract).toBe("90")
    expect(updateCalls[0]!.rateContract).toBe("55")
  })

  test("a project-side-only edit never even queries baselines", async () => {
    const { fakeDb, updateCalls } = mountFakeDb({ baselines: [] })
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const svc = await import("./construction-boq-service")
    await svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyProject: 10 })
    expect((fakeDb.query.boqBaseline.findMany as ReturnType<typeof mock>).mock.calls.length).toBe(0)
    expect(updateCalls.length).toBe(1)
  })
})

describe("updateLineItemMoneyFields -- 2-04: inline validation, server-side backstop", () => {
  test("a negative quantity is REFUSED (400), on either side", async () => {
    const { svc } = await mountAndImport({})
    await expect(svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyProject: -5 })).rejects.toMatchObject({ status: 400 })
    await expect(svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyContract: -5 })).rejects.toMatchObject({ status: 400 })
  })

  test("a negative rate is ACCEPTED (a credit line is legitimate, A4) -- not refused on either side", async () => {
    const { svc, updateCalls } = await mountAndImport({})
    await svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { rateProject: -10 })
    expect(updateCalls[0]!.rateProject).toBe("-10")
  })

  test("a non-numeric value is REFUSED (400)", async () => {
    const { svc } = await mountAndImport({})
    await expect(
      svc.updateLineItemMoneyFields({ orgId: ORG_ID }, LINE_ID, { qtyProject: Number("not-a-number") })
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe("updateLineItemMoneyFields -- not found", () => {
  test("an unknown line item is refused 404, before any baseline check", async () => {
    const fakeDb = {
      query: {
        constructionBoqLineItems: { findFirst: mock(async () => null) },
        constructionBoqs: { findFirst: mock(async () => null) },
        boqBaseline: { findMany: mock(async () => []) },
      },
      update: mock(() => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) })),
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const svc = await import("./construction-boq-service")
    await expect(svc.updateLineItemMoneyFields({ orgId: ORG_ID }, "missing", { qtyProject: 1 })).rejects.toMatchObject({ status: 404 })
  })
})

// REGRESSION (2026-09-13, real Env-1 CI fallout -- R-50 Phase 2's own first
// real run): the PATCH route (route.ts) calls updateLineItemBudget()
// UNCONDITIONALLY before it ever looks at hasMoneyFieldEdit, so a caller
// that sends ONLY one of the grid's own dual-view money fields (exactly
// what BoqDualViewGrid.tsx's commitCell() does -- a single-field body,
// `{ [field]: value }`) reaches updateLineItemBudget() with all SIX of
// its own fields undefined. Confirmed via a real Env-1 CI run's server log
// ("v1 construction BOQ line-item update error: Error: No values to set",
// thrown from `es.set` inside this file's own compiled chunk): drizzle-orm's
// REAL postgres.js driver throws on `.update(...).set({})` -- an empty
// object -- which the OLDER version of every other test in this file could
// never catch, because their fake `db.update().set()` accepts anything
// unconditionally and never replicates that real-driver behavior. That
// silent mock/reality gap is exactly why this is a SEPARATE describe block
// with its OWN fake db that fails loudly on an empty set, rather than reusing
// mountFakeDb/mountAndImport above.
describe("updateLineItemBudget -- an all-undefined patch is a no-op read, never an empty DB write", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  function mountFakeDbThatRejectsEmptySet() {
    const setCalls: Array<Record<string, unknown>> = []
    const fakeDb = {
      query: {
        constructionBoqLineItems: {
          findFirst: mock(async () => ({
            id: LINE_ID, boqId: BOQ_ID, itemCode: "C-01", parentLineItemId: null,
            description: "Excavation", unit: "m3", quantity: "100", rate: "50", amount: "5000",
            breakdownPercentage: null, materialCost: null, labourCost: null, equipmentCost: null,
            overheadPercent: null, profitPercent: null, materialAmount: null, manpowerAmount: null,
            category: null, vendorId: null, vendorAmount: null,
            qtyProject: null, rateProject: null, qtyContract: null, rateContract: null,
          })),
        },
        constructionBoqs: { findFirst: mock(async () => ({ id: BOQ_ID, orgId: ORG_ID })) },
      },
      update: mock(() => ({
        // Faithful to the real drizzle-orm/postgres.js driver this file's
        // OTHER fakes do not replicate: `.set({})` throws, exactly like the
        // real "No values to set" seen in the real CI run this regression
        // test is named for.
        set: (values: Record<string, unknown>) => {
          if (Object.keys(values).length === 0) throw new Error("No values to set")
          setCalls.push(values)
          return { where: () => ({ returning: async () => [{ id: LINE_ID, boqId: BOQ_ID, ...values }] }) }
        },
      })),
    }
    return { fakeDb, setCalls }
  }

  test("a body with none of updateLineItemBudget's own fields never calls .set() at all -- returns the existing row", async () => {
    const { fakeDb, setCalls } = mountFakeDbThatRejectsEmptySet()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const svc = await import("./construction-boq-service")
    // The exact real-world shape: BoqDualViewGrid.tsx's commitCell() sends
    // only ONE dual-view money field, none of updateLineItemBudget's own six.
    const result = await svc.updateLineItemBudget({ orgId: ORG_ID }, LINE_ID, {})
    expect(setCalls.length).toBe(0) // never even attempted the empty write
    expect(result.id).toBe(LINE_ID)
    expect(result.description).toBe("Excavation") // the real, unmodified existing row
  })

  test("a body with a real budget field still writes normally", async () => {
    const { fakeDb, setCalls } = mountFakeDbThatRejectsEmptySet()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const svc = await import("./construction-boq-service")
    const result = await svc.updateLineItemBudget({ orgId: ORG_ID }, LINE_ID, { budgetPercentage: 40 })
    expect(setCalls.length).toBe(1)
    expect(setCalls[0]!.budgetPercentage).toBe("40")
    expect(result.budgetPercentage).toBe("40")
  })
})
