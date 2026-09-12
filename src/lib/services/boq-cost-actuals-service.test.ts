/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 5 (A5, gates 5-01..5-07) -- tests for
// boq-cost-actuals-service.ts's computeCommittedCost/computeSpentCost/
// computeCostVariance/isCommittedOverBaseline.
//
// This does NOT touch a live DB -- this repo's own established convention
// (construction-expense-service.test.ts's header: "this repo's CI runs
// `bun test` against a placeholder DATABASE_URL with no real Postgres
// behind it ... a fake in-memory db is the right, precedented level of
// rigor here, not a corner cut"). withTenantContext is mocked to hand the
// fake db straight to the callback, and requireConstructionEnabledWithDb is
// mocked to always allow -- construction-enablement-service.ts already has
// its own coverage for the gate itself, this file's job is the money math.
//
// The fake db's findMany implementations do NOT ignore their `where`
// argument -- they walk the REAL drizzle condition tree the service built
// (eq/ne/inArray, at any AND depth) and filter the fixture with it, the
// same technique construction-labour-service.test.ts established for
// eq/gte/lte. So if the service ever stopped scoping by orgId/projectId, or
// stopped excluding draft/cancelled rows, the fake would return the wrong
// rows and these tests would fail -- which is exactly the regression class
// they exist to catch, not just "does the reduce add up".
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablement = await import("./construction-enablement-service")

// ─── Real drizzle condition-tree walker (eq "=", ne "<>", inArray "in") ────
type Predicate = { column: string; op: string; value: unknown }

function isParam(x: unknown): x is { value: unknown } {
  return !!x && typeof x === "object" && !Array.isArray(x) && "value" in x && "encoder" in x
}
function isColumn(x: unknown): x is { name: string } {
  return !!x && typeof x === "object" && "columnType" in x && "name" in x
}
function isStringChunk(x: unknown): x is { value: unknown[] } {
  return !!x && typeof x === "object" && !Array.isArray(x) && Array.isArray((x as { value?: unknown }).value)
}

function extractPredicates(node: unknown, acc: Predicate[] = []): Predicate[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return acc
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return acc
  let pendingColumn: string | null = null
  let pendingOp: string | null = null
  for (const chunk of chunks) {
    if (isColumn(chunk)) {
      pendingColumn = chunk.name
      pendingOp = null
    } else if (isStringChunk(chunk)) {
      if (pendingColumn && pendingOp === null) pendingOp = (chunk.value.join("") || "").trim()
    } else if (isParam(chunk)) {
      if (pendingColumn && pendingOp) {
        acc.push({ column: pendingColumn, op: pendingOp, value: chunk.value })
        pendingColumn = null
        pendingOp = null
      }
    } else if (Array.isArray(chunk)) {
      // inArray's value list: a plain array of Param nodes.
      if (pendingColumn && pendingOp) {
        acc.push({ column: pendingColumn, op: pendingOp, value: chunk.filter(isParam).map((p) => p.value) })
        pendingColumn = null
        pendingOp = null
      }
    } else {
      extractPredicates(chunk, acc)
    }
  }
  return acc
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function satisfies(row: Record<string, unknown>, where: unknown): boolean {
  return extractPredicates(where).every(({ column, op, value }) => {
    const actual = row[snakeToCamel(column)]
    if (op === "=") return actual === value
    if (op === "<>") return actual !== value
    if (op === "in") return Array.isArray(value) && value.includes(actual)
    throw new Error(`unhandled predicate operator "${op}" on ${column}`)
  })
}

// ─── Fixtures + fake db ─────────────────────────────────────────────────────
const ORG = "org-r85a3-p5"
const OTHER_ORG = "org-other"
const PROJECT = "project-r85a3-p5"
const OTHER_PROJECT = "project-other"

type Row = Record<string, unknown>

function makeFakeDb(seed: { projects?: Row[]; purchaseOrders?: Row[]; attendance?: Row[]; invoices?: Row[] } = {}) {
  const store = {
    projects: seed.projects ?? [{ id: PROJECT, orgId: ORG, name: "Cedar Heights Villa" }],
    purchaseOrders: [...(seed.purchaseOrders ?? [])] as Row[],
    attendance: [...(seed.attendance ?? [])] as Row[],
    invoices: [...(seed.invoices ?? [])] as Row[],
  }

  const db = {
    query: {
      projects: {
        findFirst: async ({ where }: { where: unknown }) => store.projects.find((p) => satisfies(p, where)),
      },
      erpPurchaseOrders: {
        findMany: async ({ where, columns }: { where: unknown; columns?: { id?: boolean } }) => {
          const rows = store.purchaseOrders.filter((p) => satisfies(p, where))
          if (columns?.id) return rows.map((r) => ({ id: r.id }))
          return rows
        },
      },
      constructionAttendance: {
        findMany: async ({ where }: { where: unknown }) => store.attendance.filter((r) => satisfies(r, where)),
      },
      erpPurchaseInvoices: {
        findMany: async ({ where }: { where: unknown }) => store.invoices.filter((r) => satisfies(r, where)),
      },
    },
  }

  return { db, store }
}

async function loadServiceWith(fakeDb: ReturnType<typeof makeFakeDb>["db"]) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  await mock.module("./construction-enablement-service", () => ({
    ...realEnablement,
    requireConstructionEnabledWithDb: mock(async () => undefined),
  }))
  return import("./boq-cost-actuals-service")
}

afterEach(async () => {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./construction-enablement-service", () => realEnablement)
})

// ─── 5-01: committed = SUM(PO grand_total, non-draft/non-cancelled) + SUM(attendance daily_cost) ───
describe("computeCommittedCost -- 5-01", () => {
  test("sums live POs and attendance for the project, excluding draft/cancelled POs and other org/project noise", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [
        { id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "100000" },
        { id: "po-2", orgId: ORG, projectId: PROJECT, status: "partially_received", grandTotal: "50000" },
        { id: "po-draft", orgId: ORG, projectId: PROJECT, status: "draft", grandTotal: "999999" },
        { id: "po-cancelled", orgId: ORG, projectId: PROJECT, status: "cancelled", grandTotal: "999999" },
        { id: "po-other-project", orgId: ORG, projectId: OTHER_PROJECT, status: "submitted", grandTotal: "999999" },
        { id: "po-other-org", orgId: OTHER_ORG, projectId: PROJECT, status: "submitted", grandTotal: "999999" },
      ],
      attendance: [
        { id: "a-1", orgId: ORG, projectId: PROJECT, dailyCost: "5000" },
        { id: "a-2", orgId: ORG, projectId: PROJECT, dailyCost: "2500" },
        { id: "a-other-project", orgId: ORG, projectId: OTHER_PROJECT, dailyCost: "999999" },
      ],
    })
    const { computeCommittedCost } = await loadServiceWith(db)
    const result = await computeCommittedCost({ orgId: ORG }, PROJECT)
    // 100000 + 50000 (POs) + 5000 + 2500 (attendance) = 157500
    expect(result).toBe(157500)
  })
})

// ─── 5-02: spent = SUM(received invoices reached via the project's own POs) ───
describe("computeSpentCost -- 5-02", () => {
  test("sums non-draft/non-cancelled invoices reachable through the project's POs only", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [
        { id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "100000" },
        { id: "po-other-project", orgId: ORG, projectId: OTHER_PROJECT, status: "submitted", grandTotal: "1" },
      ],
      invoices: [
        { id: "inv-1", orgId: ORG, purchaseOrderId: "po-1", status: "submitted", grandTotal: "40000" },
        { id: "inv-2", orgId: ORG, purchaseOrderId: "po-1", status: "paid", grandTotal: "10000" },
        { id: "inv-draft", orgId: ORG, purchaseOrderId: "po-1", status: "draft", grandTotal: "999999" },
        { id: "inv-other-po", orgId: ORG, purchaseOrderId: "po-other-project", status: "submitted", grandTotal: "999999" },
        { id: "inv-unlinked", orgId: ORG, purchaseOrderId: null, status: "submitted", grandTotal: "999999" },
      ],
    })
    const { computeSpentCost } = await loadServiceWith(db)
    const result = await computeSpentCost({ orgId: ORG }, PROJECT)
    // 40000 + 10000 = 50000; the draft, the other project's PO, and the
    // never-linked invoice are each excluded for a DIFFERENT real reason.
    expect(result).toBe(50000)
  })

  test("an invoice's status is actually excluded when draft/cancelled, not just the fixture's id label", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [{ id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "1" }],
      invoices: [
        { id: "inv-real-cancelled", orgId: ORG, purchaseOrderId: "po-1", status: "cancelled", grandTotal: "999999" },
        { id: "inv-real-submitted", orgId: ORG, purchaseOrderId: "po-1", status: "submitted", grandTotal: "7000" },
      ],
    })
    const { computeSpentCost } = await loadServiceWith(db)
    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(7000)
  })
})

// ─── 5-03 / X-04: NOT_SET, never 0, when there is truly no source data ─────
describe("NOT_SET propagation -- 5-03 (the most important test in this phase)", () => {
  test("a project with zero POs and zero attendance rows shows COMMITTED as NOT_SET, never 0", async () => {
    const { db } = makeFakeDb({})
    const { computeCommittedCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)
  })

  test("a project with zero received invoices (and therefore zero POs) shows SPENT as NOT_SET, never 0", async () => {
    const { db } = makeFakeDb({})
    const { computeSpentCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)
  })

  test("a project WITH POs but whose only invoice is draft still shows SPENT as NOT_SET", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [{ id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "500" }],
      invoices: [{ id: "inv-draft", orgId: ORG, purchaseOrderId: "po-1", status: "draft", grandTotal: "500" }],
    })
    const { computeSpentCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)
  })

  test("a real $0 PO is a real number, not NOT_SET -- absence and a genuine zero are different answers", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [{ id: "po-zero", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "0" }],
    })
    const { computeCommittedCost } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(0)
  })

  test("committed and spent are independent: one can be a real number while the other is NOT_SET", async () => {
    const { db } = makeFakeDb({
      purchaseOrders: [{ id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "1000" }],
      // no invoices at all -- spent has nothing to sum, committed does
    })
    const { computeCommittedCost, computeSpentCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(1000)
    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)
  })

  test("Project not found is a 404, not a NOT_SET or a 0", async () => {
    const { db } = makeFakeDb({ projects: [] })
    const { computeCommittedCost } = await loadServiceWith(db)
    await expect(computeCommittedCost({ orgId: ORG }, "no-such-project")).rejects.toThrow("Project not found")
  })
})

// ─── 5-04: "recompute" is automatic (no cache) -- prove each of the 4 triggers ───
describe("recompute on write -- 5-04 (nothing is cached; the next read reflects the new row)", () => {
  test("PO CREATE: committed reflects a newly-added PO on the very next read", async () => {
    const { db, store } = makeFakeDb({})
    const { computeCommittedCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)

    // Simulates erp-buying-service.ts's createPurchaseOrder landing a new row.
    store.purchaseOrders.push({ id: "po-new", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "25000" })

    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(25000)
  })

  test("PO AMEND: committed reflects an updated grand_total on the very next read", async () => {
    const po: Row = { id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "10000" }
    const { db } = makeFakeDb({ purchaseOrders: [po] })
    const { computeCommittedCost } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(10000)

    // Simulates erp-buying-service.ts's updatePurchaseOrder amending the total.
    po.grandTotal = "17500"

    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(17500)
  })

  test("PO CANCEL: committed drops the PO's total on the very next read", async () => {
    const po: Row = { id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "10000" }
    const { db } = makeFakeDb({ purchaseOrders: [po] })
    const { computeCommittedCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(10000)

    // Simulates erp-buying-service.ts's cancelPurchaseOrder.
    po.status = "cancelled"

    expect(await computeCommittedCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)
  })

  test("INVOICE RECEIPT: spent reflects a newly-received invoice on the very next read", async () => {
    const { db, store } = makeFakeDb({
      purchaseOrders: [{ id: "po-1", orgId: ORG, projectId: PROJECT, status: "submitted", grandTotal: "10000" }],
    })
    const { computeSpentCost, NOT_SET } = await loadServiceWith(db)
    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(NOT_SET)

    // Simulates erp-invoicing-service.ts's createPurchaseInvoice + submitPurchaseInvoice.
    store.invoices.push({ id: "inv-new", orgId: ORG, purchaseOrderId: "po-1", status: "submitted", grandTotal: "6000" })

    expect(await computeSpentCost({ orgId: ORG }, PROJECT)).toBe(6000)
  })
})

// ─── 5-06: cost variance, labelled, NOT_SET-propagating ────────────────────
describe("computeCostVariance -- 5-06", () => {
  test("baseline - committed, labelled 'committed'", async () => {
    const { computeCostVariance } = await import("./boq-cost-actuals-service")
    expect(computeCostVariance(598000, 645000, "committed")).toEqual({
      label: "committed",
      baselineEstimatedCost: 598000,
      actual: 645000,
      variance: -47000,
    })
  })

  test("baseline - spent, labelled 'spent'", async () => {
    const { computeCostVariance } = await import("./boq-cost-actuals-service")
    expect(computeCostVariance(598000, 412000, "spent")).toEqual({
      label: "spent",
      baselineEstimatedCost: 598000,
      actual: 412000,
      variance: 186000,
    })
  })

  test("NOT_SET baseline propagates to NOT_SET variance, never a number computed against it", async () => {
    const { computeCostVariance, NOT_SET } = await import("./boq-cost-actuals-service")
    const result = computeCostVariance(NOT_SET, 100, "committed")
    expect(result.variance).toBe(NOT_SET)
  })

  test("NOT_SET actual propagates to NOT_SET variance", async () => {
    const { computeCostVariance, NOT_SET } = await import("./boq-cost-actuals-service")
    const result = computeCostVariance(500, NOT_SET, "spent")
    expect(result.variance).toBe(NOT_SET)
  })
})

// ─── 5-07 / C-4: committed exceeding the baseline estimate is detectable ───
describe("isCommittedOverBaseline -- 5-07 / C-4 warning signal", () => {
  test("committed above baseline is TRUE (the job is drifting)", async () => {
    const { isCommittedOverBaseline } = await import("./boq-cost-actuals-service")
    expect(isCommittedOverBaseline(598000, 645000)).toBe(true)
  })

  test("committed at or below baseline is FALSE", async () => {
    const { isCommittedOverBaseline } = await import("./boq-cost-actuals-service")
    expect(isCommittedOverBaseline(598000, 598000)).toBe(false)
    expect(isCommittedOverBaseline(598000, 500000)).toBe(false)
  })

  test("NOT_SET on either side is FALSE, never a fabricated warning", async () => {
    const { isCommittedOverBaseline, NOT_SET } = await import("./boq-cost-actuals-service")
    expect(isCommittedOverBaseline(NOT_SET, 645000)).toBe(false)
    expect(isCommittedOverBaseline(598000, NOT_SET)).toBe(false)
  })
})
