// R67 D-36 (soft void on inbound material receipts).
// construction-materials-service.ts had no sibling test before this file,
// which is also why this repo's "New Test Coverage Check" CI gate requires
// one the moment the service is touched.
//
// WHAT THIS EXERCISES AND HOW HONESTLY. No live DB. The real
// voidMaterialReceipt()/getMaterialReceipt()/listMaterialReceipts()/
// getMaterialCostReport() run with only withTenantContext mocked (this
// repo's established pattern -- see construction-progress-service.test.ts).
// The fake db EVALUATES the actual drizzle condition tree each call builds
// (eq / and / isNull) against an in-memory table, so a service that stopped
// scoping by orgId, or stopped excluding voided rows from the totals, starts
// matching rows it should not and these tests fail.
//
// ONE DELIBERATE STAND-IN, stated rather than hidden: getMaterialCostReport
// asks Postgres for `sum(quantity)` / `sum(quantity * unit_cost)` grouped by
// material. Summing is Postgres's job, not this repo's, so the fake performs
// that arithmetic itself over the rows the service's OWN where-clause and
// groupBy selected. What this therefore proves is the filtering and grouping
// the service is responsible for -- specifically that a voided receipt is
// excluded -- not that Postgres can add up. A regression that dropped the
// isNull(voidedAt) predicate fails here; a regression inside Postgres's SUM
// would not, and is not what this file claims to cover.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import type { SQL } from "drizzle-orm"

const ORG = "org-r67-d36"
const OTHER_ORG = "org-other"
const PROJECT = "project-cedar"

type Row = Record<string, unknown>

function isSql(node: unknown): node is { queryChunks: unknown[] } {
  return !!node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)
}
function isColumn(node: unknown): node is { name: string } {
  return !!node && typeof node === "object" && "columnType" in node && "name" in node
}
function isParam(node: unknown): node is { value: unknown } {
  return !!node && typeof node === "object" && "encoder" in node && "value" in node
}
function isStringChunk(node: unknown): node is { value: string[] } {
  return !!node && typeof node === "object" && !("encoder" in node) && Array.isArray((node as { value?: unknown }).value)
}
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

// Drizzle leaf shape: [StringChunk(""), Column, StringChunk(" <op> "),
// operand?, StringChunk("")]; `isNull` has the operator " is null" and no
// operand; `and(...)` interleaves sub-SQL nodes with StringChunk(" and ").
// Verified empirically against this repo's drizzle-orm version.
function evaluateCondition(node: unknown, row: Row): boolean {
  if (node === undefined || node === null) return true
  if (!isSql(node)) throw new Error("fake db: unsupported condition node (not a drizzle SQL chunk)")
  const chunks = node.queryChunks

  const colIndex = chunks.findIndex(isColumn)
  if (colIndex !== -1) {
    const column = chunks[colIndex] as { name: string }
    const opChunk = chunks[colIndex + 1]
    const operand = chunks[colIndex + 2]
    const op = isStringChunk(opChunk) ? String(opChunk.value[0]).trim() : ""
    const actual = row[snakeToCamel(column.name)]

    if (op === "is null") return actual === null || actual === undefined
    if (op === "is not null") return actual !== null && actual !== undefined
    if (op === "in") {
      if (!Array.isArray(operand)) throw new Error("fake db: 'in' operand was not an array of params")
      return operand.map((p) => (isParam(p) ? p.value : p)).includes(actual)
    }
    const expected = isParam(operand) ? operand.value : operand
    switch (op) {
      case "=": return actual === expected
      case "<>": return actual !== expected
      case ">=": return String(actual) >= String(expected)
      case "<=": return String(actual) <= String(expected)
      default: throw new Error(`fake db: unsupported operator "${op}"`)
    }
  }

  const subConditions = chunks.filter(isSql)
  if (subConditions.length === 0) throw new Error("fake db: condition had neither a column nor sub-conditions")
  const joiners = chunks.filter(isStringChunk).map((c) => String(c.value[0]).trim()).filter((s) => s === "and" || s === "or")
  const results = subConditions.map((sub) => evaluateCondition(sub, row))
  return joiners.includes("or") ? results.some(Boolean) : results.every(Boolean)
}

// ── fixtures ────────────────────────────────────────────────────────────
const CEMENT = { id: "mat-cement", orgId: ORG, projectId: PROJECT, name: "Cement OPC 53", spec: "53 grade", unit: "bag", unitCost: "420", isActive: true }
const STEEL = { id: "mat-steel", orgId: ORG, projectId: PROJECT, name: "Steel rebar 12mm", spec: null, unit: "kg", unitCost: "3", isActive: true }

function receipt(overrides: Row): Row {
  return {
    id: "rec-x", orgId: ORG, projectId: PROJECT, materialId: CEMENT.id,
    receivedDate: "2026-08-28", quantity: "50", unitCost: "435",
    vendorId: null, reference: null, notes: null,
    voidedAt: null, voidReason: null, voidedBy: null,
    createdById: "user-1", createdAt: new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  }
}

let materialRows: Row[] = []
let receiptRows: Row[] = []

const mockWithTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  void ctx
  return fn(fakeDb as unknown as never)
})

let selectedGroupColumn: string | null = null

const fakeDb = {
  query: {
    constructionMaterials: {
      findMany: async ({ where }: { where: SQL }) => materialRows.filter((r) => evaluateCondition(where, r)),
      findFirst: async ({ where }: { where: SQL }) => materialRows.find((r) => evaluateCondition(where, r)),
    },
    constructionMaterialReceipts: {
      findMany: async ({ where }: { where: SQL }) => receiptRows.filter((r) => evaluateCondition(where, r)),
      findFirst: async ({ where }: { where: SQL }) => receiptRows.find((r) => evaluateCondition(where, r)),
    },
  },
  // See the file header: this stands in for Postgres's own SUM/GROUP BY over
  // exactly the rows the service's real where-clause selected.
  select: () => ({
    from: () => ({
      where: (where: SQL) => ({
        groupBy: (column: { name: string }) => {
          selectedGroupColumn = column.name
          const matching = receiptRows.filter((r) => evaluateCondition(where, r))
          const groups = new Map<string, Row[]>()
          for (const r of matching) {
            const key = String(r[snakeToCamel(column.name)])
            groups.set(key, [...(groups.get(key) ?? []), r])
          }
          return Promise.resolve([...groups.entries()].map(([materialId, rows]) => ({
            materialId,
            totalQuantityReceived: String(rows.reduce((s, r) => s + Number(r.quantity), 0)),
            totalCost: String(rows.reduce((s, r) => s + Number(r.quantity) * Number(r.unitCost), 0)),
          })))
        },
      }),
    }),
  }),
  insert: () => ({
    values: (value: Row) => ({
      returning: async () => {
        const created = { id: `rec-${receiptRows.length + 1}`, createdAt: new Date("2026-09-03T00:00:00Z"), ...value }
        receiptRows.push(created)
        return [created]
      },
    }),
  }),
  update: () => ({
    set: (patch: Row) => ({
      where: (where: SQL) => ({
        returning: async () => {
          const hits = receiptRows.filter((r) => evaluateCondition(where, r))
          for (const hit of hits) Object.assign(hit, patch)
          return hits
        },
      }),
    }),
  }),
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
async function useMocks(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
}

beforeEach(() => {
  materialRows = [{ ...CEMENT }, { ...STEEL }]
  receiptRows = []
  selectedGroupColumn = null
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

describe("voidMaterialReceipt + getMaterialCostReport -- R67 D-36 acceptance", () => {
  test("voiding a receipt of 50 units at 435 removes exactly that receipt from the material's totals, and the row is still returned with voidedAt set", async () => {
    await useMocks()
    const { voidMaterialReceipt, getMaterialCostReport, listMaterialReceipts } = await import("./construction-materials-service")

    receiptRows = [
      receipt({ id: "rec-keep", quantity: "80", unitCost: "420" }),
      receipt({ id: "rec-void", quantity: "50", unitCost: "435" }),
    ]

    const before = await getMaterialCostReport({ orgId: ORG }, PROJECT)
    const beforeCement = before.find((r) => r.materialId === CEMENT.id)!
    expect(beforeCement.totalQuantityReceived).toBe(130)
    expect(beforeCement.totalCost).toBe(80 * 420 + 50 * 435)

    const voided = await voidMaterialReceipt({ orgId: ORG }, "rec-void", { voidReason: "Quantity keyed wrong", voidedBy: "user-9" })
    expect(voided.voidedAt).toBeInstanceOf(Date)
    expect(voided.voidReason).toBe("Quantity keyed wrong")
    expect(voided.voidedBy).toBe("user-9")

    const after = await getMaterialCostReport({ orgId: ORG }, PROJECT)
    const afterCement = after.find((r) => r.materialId === CEMENT.id)!
    expect(afterCement.totalQuantityReceived).toBe(beforeCement.totalQuantityReceived - 50)
    expect(afterCement.totalCost).toBe(beforeCement.totalCost - 50 * 435)

    // Soft, not a delete: the row is still in the ledger listing.
    const listed = await listMaterialReceipts({ orgId: ORG }, PROJECT)
    expect(listed.map((r) => r.id).sort()).toEqual(["rec-keep", "rec-void"])
    expect(listed.find((r) => r.id === "rec-void")!.voidedAt).toBeInstanceOf(Date)

    expect(selectedGroupColumn).toBe("material_id")
  })

  test("voiding the only receipt for a material drops that material out of the report entirely rather than reporting a zero-cost row", async () => {
    await useMocks()
    const { voidMaterialReceipt, getMaterialCostReport } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-only", materialId: STEEL.id, quantity: "1000", unitCost: "3" })]
    await voidMaterialReceipt({ orgId: ORG }, "rec-only", { voidReason: "Duplicate entry", voidedBy: "user-9" })

    const report = await getMaterialCostReport({ orgId: ORG }, PROJECT)
    expect(report.find((r) => r.materialId === STEEL.id)).toBeUndefined()
  })

  test("averageUnitCost is recomputed from the surviving receipts, not from the voided ones", async () => {
    await useMocks()
    const { voidMaterialReceipt, getMaterialCostReport } = await import("./construction-materials-service")

    receiptRows = [
      receipt({ id: "rec-a", quantity: "100", unitCost: "400" }),
      receipt({ id: "rec-b", quantity: "100", unitCost: "600" }),
    ]
    await voidMaterialReceipt({ orgId: ORG }, "rec-b", { voidReason: "Wrong supplier", voidedBy: "user-9" })

    const cement = (await getMaterialCostReport({ orgId: ORG }, PROJECT)).find((r) => r.materialId === CEMENT.id)!
    expect(cement.averageUnitCost).toBe(400)
  })
})

describe("voidMaterialReceipt -- refusals", () => {
  test("an empty reason is refused with a 400 and nothing is written", async () => {
    await useMocks()
    const { voidMaterialReceipt, ServiceError } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1" })]

    await expect(voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "   ", voidedBy: "user-9" }))
      .rejects.toThrow(ServiceError)
    expect(receiptRows[0].voidedAt).toBeNull()
  })

  test("voiding twice is refused (409) rather than silently overwriting the first reason", async () => {
    await useMocks()
    const { voidMaterialReceipt, ServiceError } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1" })]

    await voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "First reason", voidedBy: "user-9" })
    await expect(voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "Second reason", voidedBy: "user-9" }))
      .rejects.toThrow(ServiceError)
    expect(receiptRows[0].voidReason).toBe("First reason")
  })

  test("a receipt belonging to another org cannot be voided -- the lookup is org-scoped, not id-only", async () => {
    await useMocks()
    const { voidMaterialReceipt, ServiceError } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1", orgId: OTHER_ORG })]

    await expect(voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "Not mine", voidedBy: "user-9" }))
      .rejects.toThrow(ServiceError)
    expect(receiptRows[0].voidedAt).toBeNull()
  })
})

describe("getMaterialReceipt / createMaterialReceipt -- R67 D-36 object page fields", () => {
  test("getMaterialReceipt returns the row for this org and 404s for another org's", async () => {
    await useMocks()
    const { getMaterialReceipt, ServiceError } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1", reference: "DN-4471" }), receipt({ id: "rec-2", orgId: OTHER_ORG })]

    const found = await getMaterialReceipt({ orgId: ORG }, "rec-1")
    expect(found.reference).toBe("DN-4471")
    await expect(getMaterialReceipt({ orgId: ORG }, "rec-2")).rejects.toThrow(ServiceError)
  })

  test("a receipt stores vendorId and reference, and a blank reference is stored as null rather than an empty string", async () => {
    await useMocks()
    const { createMaterialReceipt } = await import("./construction-materials-service")

    const withRef = await createMaterialReceipt({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, receivedDate: "2026-09-01",
      quantity: 50, unitCost: 435, vendorId: "vendor-7", reference: "  DN-4471 ", createdById: "user-1",
    })
    expect(withRef.reference).toBe("DN-4471")
    expect(withRef.vendorId).toBe("vendor-7")

    const withoutRef = await createMaterialReceipt({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, receivedDate: "2026-09-01",
      quantity: 10, createdById: "user-1", reference: "   ",
    })
    expect(withoutRef.reference).toBeNull()
    // unitCost still defaults from the master when the receipt omits it.
    expect(withoutRef.unitCost).toBe(CEMENT.unitCost)
  })
})
