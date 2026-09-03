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
import { getTableName, type SQL, type Table } from "drizzle-orm"

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
const CEMENT = { id: "mat-cement", orgId: ORG, projectId: PROJECT, name: "Cement OPC 53", spec: "53 grade", unit: "bag", unitCost: "420", reorderLevel: null, isActive: true }
const STEEL = { id: "mat-steel", orgId: ORG, projectId: PROJECT, name: "Steel rebar 12mm", spec: null, unit: "kg", unitCost: "3", reorderLevel: null, isActive: true }

// R67 D-40
function issue(overrides: Row): Row {
  return {
    id: "iss-x", orgId: ORG, projectId: PROJECT, materialId: CEMENT.id,
    issuedDate: "2026-08-29", quantity: "10",
    boqLineItemId: null, issuedTo: null, note: null,
    createdById: "user-1", createdAt: new Date("2026-08-29T00:00:00Z"),
    ...overrides,
  }
}

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
let issueRows: Row[] = []
let userRows: Row[] = []

const mockWithTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  void ctx
  return fn(fakeDb as unknown as never)
})

let selectedGroupColumn: string | null = null

// Which in-memory table a real drizzle table object stands for. Keyed on
// drizzle's OWN table name, so a rename in schema.ts surfaces here as a loud
// "fake db: unknown table" rather than as a silently empty result.
function rowsFor(table: Table): Row[] {
  switch (getTableName(table)) {
    case "construction_material_receipts": return receiptRows
    case "construction_material_issues": return issueRows
    case "construction_materials": return materialRows
    case "users": return userRows
    default: throw new Error(`fake db: unknown table "${getTableName(table)}"`)
  }
}

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
    constructionMaterialIssues: {
      findMany: async ({ where }: { where: SQL }) => issueRows.filter((r) => evaluateCondition(where, r)),
      findFirst: async ({ where }: { where: SQL }) => issueRows.find((r) => evaluateCondition(where, r)),
    },
  },
  // See the file header: this stands in for Postgres's own SUM/GROUP BY over
  // exactly the rows the service's real where-clause selected. Which rows those
  // are comes from the REAL table handed to .from(), and what is returned comes
  // from the projection's own shape:
  //   { name, ... }                     -> getMaterialReceipt's users lookup
  //   { materialId, totalQuantity... }  -> getMaterialCostReport's aggregate
  //   { materialId, total }             -> listMaterials' quantity aggregates
  //   { total } with no groupBy         -> the single-material on-hand sums
  // Every path still runs the service's real predicates through the evaluator.
  select: (shape: Record<string, unknown>) => ({
    from: (table: Table) => ({
      where: (where: SQL) => {
        const matching = () => rowsFor(table).filter((r) => evaluateCondition(where, r))
        return {
          then: (resolve: (rows: Row[]) => unknown) => {
            if ("name" in shape) return resolve(matching())
            // An ungrouped aggregate: Postgres returns exactly one row.
            return resolve([{ total: String(matching().reduce((s, r) => s + Number(r.quantity), 0)) }])
          },
          groupBy: (column: { name: string }) => {
            selectedGroupColumn = column.name
            const groups = new Map<string, Row[]>()
            for (const r of matching()) {
              const key = String(r[snakeToCamel(column.name)])
              groups.set(key, [...(groups.get(key) ?? []), r])
            }
            return Promise.resolve([...groups.entries()].map(([materialId, rows]) => {
              const totalQuantity = rows.reduce((s, r) => s + Number(r.quantity), 0)
              return "totalQuantityReceived" in shape
                ? {
                    materialId,
                    totalQuantityReceived: String(totalQuantity),
                    totalCost: String(rows.reduce((s, r) => s + Number(r.quantity) * Number(r.unitCost), 0)),
                  }
                : { materialId, total: String(totalQuantity) }
            }))
          },
        }
      },
    }),
  }),
  insert: (table: Table) => ({
    values: (value: Row) => ({
      returning: async () => {
        const rows = rowsFor(table)
        const prefix = { construction_material_issues: "iss", construction_materials: "mat" }[getTableName(table)] ?? "rec"
        const created = { id: `${prefix}-${rows.length + 1}`, createdAt: new Date("2026-09-03T00:00:00Z"), ...value }
        rows.push(created)
        return [created]
      },
    }),
  }),
  update: (table: Table) => ({
    set: (patch: Row) => ({
      where: (where: SQL) => ({
        returning: async () => {
          // Drizzle SKIPS undefined values in .set() -- "leave this column
          // alone" -- and the reorderLevel contract depends on that difference
          // (undefined leaves it, null clears it). A fake that assigned
          // undefined would pass a broken service.
          const applied = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
          const hits = rowsFor(table).filter((r) => evaluateCondition(where, r))
          for (const hit of hits) Object.assign(hit, applied)
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
  issueRows = []
  userRows = [
    { id: "user-1", orgId: ORG, name: "Sana Iqbal" },
    { id: "user-9", orgId: ORG, name: "Rohit Verma" },
  ]
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

  test("the recorder's id is resolved to a NAME so the object page never prints a raw cuid", async () => {
    await useMocks()
    const { getMaterialReceipt, voidMaterialReceipt } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1", createdById: "user-1" })]

    expect((await getMaterialReceipt({ orgId: ORG }, "rec-1")).recordedByName).toBe("Sana Iqbal")

    await voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "Keyed wrong", voidedBy: "user-9" })
    const voided = await getMaterialReceipt({ orgId: ORG }, "rec-1")
    expect(voided.voidedByName).toBe("Rohit Verma")
  })

  test("an unresolvable recorder (an API key's id, not a user's) is null -- the screen renders the en-dash, never the id", async () => {
    await useMocks()
    const { getMaterialReceipt } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1", createdById: "apikey-abc123" })]

    const found = await getMaterialReceipt({ orgId: ORG }, "rec-1")
    expect(found.recordedByName).toBeNull()
    expect(found.voidedByName).toBeNull()
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

describe("listMaterials quantities -- R67 D-40 acceptance", () => {
  test("with receipts of 200 and issues of 80 the master row reads receivedToDate 200, issuedToDate 80, onHand 120", async () => {
    await useMocks()
    const { listMaterials } = await import("./construction-materials-service")

    receiptRows = [
      receipt({ id: "rec-1", quantity: "120" }),
      receipt({ id: "rec-2", quantity: "80" }),
    ]
    issueRows = [
      issue({ id: "iss-1", quantity: "50" }),
      issue({ id: "iss-2", quantity: "30" }),
    ]

    const cement = (await listMaterials({ orgId: ORG }, PROJECT)).find((m) => m.id === CEMENT.id)!
    expect(cement.receivedToDate).toBe(200)
    expect(cement.issuedToDate).toBe(80)
    expect(cement.onHand).toBe(120)
  })

  test("a material with no movements reads 0/0/0, not an absent field -- and the aggregate is grouped, never per material", async () => {
    await useMocks()
    const { listMaterials } = await import("./construction-materials-service")

    const steel = (await listMaterials({ orgId: ORG }, PROJECT)).find((m) => m.id === STEEL.id)!
    expect(steel.receivedToDate).toBe(0)
    expect(steel.issuedToDate).toBe(0)
    expect(steel.onHand).toBe(0)
    expect(selectedGroupColumn).toBe("material_id")
  })

  test("a VOIDED receipt does not count towards Received to date, so the master and the Cost Report agree", async () => {
    await useMocks()
    const { listMaterials, voidMaterialReceipt } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-keep", quantity: "200" }), receipt({ id: "rec-void", quantity: "50" })]
    await voidMaterialReceipt({ orgId: ORG }, "rec-void", { voidReason: "Never delivered", voidedBy: "user-9" })

    const cement = (await listMaterials({ orgId: ORG }, PROJECT)).find((m) => m.id === CEMENT.id)!
    expect(cement.receivedToDate).toBe(200)
    expect(cement.onHand).toBe(200)
  })

  test("getMaterial carries the same three quantities, so the object page and the list cannot disagree", async () => {
    await useMocks()
    const { getMaterial } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-1", quantity: "200" })]
    issueRows = [issue({ id: "iss-1", quantity: "80" })]

    const cement = await getMaterial({ orgId: ORG }, CEMENT.id)
    expect(cement.receivedToDate).toBe(200)
    expect(cement.issuedToDate).toBe(80)
    expect(cement.onHand).toBe(120)
  })
})

describe("createMaterialIssue -- R67 D-40", () => {
  test("an issue within the on-hand balance is written, with a blank issuedTo stored as null", async () => {
    await useMocks()
    const { createMaterialIssue } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-1", quantity: "200" })]

    const created = await createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02",
      quantity: 80, issuedTo: "  ", createdById: "user-1",
    })
    expect(created.quantity).toBe("80")
    expect(created.issuedTo).toBeNull()
    expect(issueRows).toHaveLength(1)
  })

  test("issuing MORE than is on hand is refused with the real figure and the real unit -- the client cap is not the rule", async () => {
    await useMocks()
    const { createMaterialIssue, ServiceError } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-1", quantity: "200" })]
    issueRows = [issue({ id: "iss-1", quantity: "80" })]

    await expect(createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02",
      quantity: 130, createdById: "user-1",
    })).rejects.toThrow("Only 120 bag on hand")

    // Nothing was written: a refused issue must not move the balance.
    expect(issueRows).toHaveLength(1)

    // And it is a 400, not a 500 -- the form shows the sentence, not a crash.
    try {
      await createMaterialIssue({ orgId: ORG }, {
        projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02",
        quantity: 130, createdById: "user-1",
      })
      throw new Error("expected a refusal")
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as InstanceType<typeof ServiceError>).status).toBe(400)
    }
  })

  test("a voided receipt does not fund an issue -- on hand is computed from surviving receipts only", async () => {
    await useMocks()
    const { createMaterialIssue, voidMaterialReceipt } = await import("./construction-materials-service")

    receiptRows = [receipt({ id: "rec-1", quantity: "200" })]
    await voidMaterialReceipt({ orgId: ORG }, "rec-1", { voidReason: "Never delivered", voidedBy: "user-9" })

    await expect(createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02",
      quantity: 1, createdById: "user-1",
    })).rejects.toThrow("Only 0 bag on hand")
  })

  test("zero and negative quantities are refused before anything is read", async () => {
    await useMocks()
    const { createMaterialIssue, ServiceError } = await import("./construction-materials-service")
    receiptRows = [receipt({ id: "rec-1", quantity: "200" })]

    await expect(createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02", quantity: 0, createdById: "user-1",
    })).rejects.toThrow(ServiceError)
    await expect(createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02", quantity: -5, createdById: "user-1",
    })).rejects.toThrow(ServiceError)
    expect(issueRows).toHaveLength(0)
  })

  test("another org's material cannot be issued against -- the lookup is org-scoped, not id-only", async () => {
    await useMocks()
    const { createMaterialIssue, ServiceError } = await import("./construction-materials-service")
    materialRows = [{ ...CEMENT, orgId: OTHER_ORG }]

    await expect(createMaterialIssue({ orgId: ORG }, {
      projectId: PROJECT, materialId: CEMENT.id, issuedDate: "2026-09-02", quantity: 1, createdById: "user-1",
    })).rejects.toThrow(ServiceError)
  })
})

describe("reorderLevel -- R67 D-40", () => {
  test("an omitted threshold is stored as null, and an explicit 0 is kept -- they are different facts", async () => {
    await useMocks()
    const { createMaterial } = await import("./construction-materials-service")

    const withoutThreshold = await createMaterial({ orgId: ORG }, { projectId: PROJECT, name: "Sand", unit: "cum" })
    expect(withoutThreshold.reorderLevel).toBeNull()

    const withZero = await createMaterial({ orgId: ORG }, { projectId: PROJECT, name: "Nails", unit: "kg", reorderLevel: 0 })
    expect(withZero.reorderLevel).toBe("0")
  })

  test("updateMaterial can CLEAR a threshold with an explicit null and leaves it alone when the key is absent", async () => {
    await useMocks()
    const { updateMaterial } = await import("./construction-materials-service")
    materialRows = [{ ...CEMENT, reorderLevel: "50" }]

    const renamed = await updateMaterial({ orgId: ORG }, CEMENT.id, { name: "Cement OPC 43" })
    expect(renamed.reorderLevel).toBe("50")

    const cleared = await updateMaterial({ orgId: ORG }, CEMENT.id, { reorderLevel: null })
    expect(cleared.reorderLevel).toBeNull()
  })
})

// ─────────────────────────── R67 D-57 (audit R-186) ─────────────────────────
// The Cost Report's From/To window. Filtered in the same grouped aggregate, so
// a month's report does not get slower as the project's history grows and the
// browser never receives receipts it is only going to discard.
describe("getMaterialCostReport From/To window -- R67 D-57", () => {
  const AUGUST = receipt({ id: "rec-aug", receivedDate: "2026-08-10", quantity: "100", unitCost: "400" })
  const SEPT_1 = receipt({ id: "rec-sep1", receivedDate: "2026-09-01", quantity: "50", unitCost: "435" })
  const SEPT_30 = receipt({ id: "rec-sep30", receivedDate: "2026-09-30", quantity: "20", unitCost: "450" })

  test("both bounds are INCLUSIVE -- a `to` of the last day includes that day's delivery", async () => {
    await useMocks()
    receiptRows = [AUGUST, SEPT_1, SEPT_30]
    const { getMaterialCostReport } = await import("./construction-materials-service")

    const september = await getMaterialCostReport({ orgId: ORG }, PROJECT, { from: "2026-09-01", to: "2026-09-30" })
    const cement = september.find((r) => r.materialId === CEMENT.id)!
    // 50 + 20, i.e. both September receipts and neither of August's.
    expect(cement.totalQuantityReceived).toBe(70)
    expect(cement.totalCost).toBe(50 * 435 + 20 * 450)
  })

  test("omitting both bounds keeps the previous all-time report exactly", async () => {
    await useMocks()
    receiptRows = [AUGUST, SEPT_1, SEPT_30]
    const { getMaterialCostReport } = await import("./construction-materials-service")

    const allTime = await getMaterialCostReport({ orgId: ORG }, PROJECT)
    expect(allTime.find((r) => r.materialId === CEMENT.id)!.totalQuantityReceived).toBe(170)
  })

  test("one bound alone works: `from` is an open-ended window forward", async () => {
    await useMocks()
    receiptRows = [AUGUST, SEPT_1, SEPT_30]
    const { getMaterialCostReport } = await import("./construction-materials-service")

    const since = await getMaterialCostReport({ orgId: ORG }, PROJECT, { from: "2026-09-01" })
    expect(since.find((r) => r.materialId === CEMENT.id)!.totalQuantityReceived).toBe(70)

    const until = await getMaterialCostReport({ orgId: ORG }, PROJECT, { to: "2026-08-31" })
    expect(until.find((r) => r.materialId === CEMENT.id)!.totalQuantityReceived).toBe(100)
  })

  test("a window that excludes everything returns NO rows, never rows of zero", async () => {
    await useMocks()
    receiptRows = [AUGUST, SEPT_1, SEPT_30]
    const { getMaterialCostReport } = await import("./construction-materials-service")

    expect(await getMaterialCostReport({ orgId: ORG }, PROJECT, { from: "2027-01-01", to: "2027-01-31" })).toEqual([])
  })

  test("the void exclusion still applies INSIDE the window -- the two filters compose", async () => {
    await useMocks()
    receiptRows = [
      SEPT_1,
      receipt({ id: "rec-sep2", receivedDate: "2026-09-02", quantity: "999", unitCost: "1", voidedAt: new Date("2026-09-03T00:00:00Z"), voidReason: "mis-keyed" }),
    ]
    const { getMaterialCostReport } = await import("./construction-materials-service")

    const september = await getMaterialCostReport({ orgId: ORG }, PROJECT, { from: "2026-09-01", to: "2026-09-30" })
    expect(september.find((r) => r.materialId === CEMENT.id)!.totalQuantityReceived).toBe(50)
  })
})
