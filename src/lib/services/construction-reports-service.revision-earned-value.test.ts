/// <reference types="bun-types" />
// R-51 / R-52 (UI audit 2026-10-19, "Defects and gaps" item 1): after a BOQ
// revision the dashboard's "% complete by BOQ value" dropped to 0% because
// earned value looked progress up by the LATEST revision's line ids only, so
// every entry logged against the superseded revision vanished. Progress now
// carries across a revision by item code (R-20: revisions preserve item codes).
//
// Two layers: the pure fold (foldProgressAcrossRevisions) and the real
// earnedValueReport() run over an in-memory store that aggregates the way the
// SQL does (summed DELTA quantity, latest percent by date per line).
import { afterEach, describe, expect, mock, test } from "bun:test"
import { foldProgressAcrossRevisions, type ProgressSourceRow } from "./construction-reports-service"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablement = await import("./construction-enablement-service")

type Line = { id: string; boqId: string; itemCode: string | null; parentLineItemId: string | null; rate: string; amount: string; breakdownPercentage: string | null }
type Entry = { lineId: string; basis: "DELTA" | "SNAPSHOT"; qty: number; percent: number; date: string }

// Parent 1 with two 50% children. v1 is worth 7,000, the revision (v2) 9,000.
// Three Delta entries of 10 units on sub-task 1.1 (logged on v1).
const V1 = "boq-v1"
const V2 = "boq-v2"
const v1Lines: Line[] = [
  { id: "v1-1", boqId: V1, itemCode: "1", parentLineItemId: null, rate: "70", amount: "7000", breakdownPercentage: null },
  { id: "v1-11", boqId: V1, itemCode: "1.1", parentLineItemId: "v1-1", rate: "70", amount: "3500", breakdownPercentage: "50" },
  { id: "v1-12", boqId: V1, itemCode: "1.2", parentLineItemId: "v1-1", rate: "70", amount: "3500", breakdownPercentage: "50" },
]
const v2Lines: Line[] = [
  { id: "v2-1", boqId: V2, itemCode: "1", parentLineItemId: null, rate: "90", amount: "9000", breakdownPercentage: null },
  { id: "v2-11", boqId: V2, itemCode: "1.1", parentLineItemId: "v2-1", rate: "90", amount: "4500", breakdownPercentage: "50" },
  { id: "v2-12", boqId: V2, itemCode: "1.2", parentLineItemId: "v2-1", rate: "90", amount: "4500", breakdownPercentage: "50" },
]

function makeDb(boqs: { id: string; status: string; version: number }[], lines: Line[], entries: Entry[]) {
  let lineFindManyCall = 0
  let executeCall = 0
  const currentBoqId = boqs.find((b) => b.status !== "superseded")!.id
  const passedIds = new Set<string>()
  return {
    query: {
      constructionBoqs: {
        findMany: async () => boqs.map((b) => ({ ...b, createdAt: new Date(0), projectId: "p1", orgId: "org-1" })),
      },
      constructionBoqLineItems: {
        // 1st call = latest revision's lines, 2nd = superseded revisions' lines
        // (the order earnedValueReport reads them in).
        findMany: async () => {
          lineFindManyCall += 1
          const out = lineFindManyCall === 1 ? lines.filter((l) => l.boqId === currentBoqId) : lines.filter((l) => l.boqId !== currentBoqId)
          out.forEach((l) => passedIds.add(l.id))
          return out
        },
      },
    },
    // 1st execute = summed DELTA quantity per line, 2nd = latest percent per line.
    execute: async () => {
      executeCall += 1
      const mine = entries.filter((e) => passedIds.has(e.lineId))
      if (executeCall === 1) {
        const byLine = new Map<string, number>()
        for (const e of mine.filter((x) => x.basis === "DELTA")) byLine.set(e.lineId, (byLine.get(e.lineId) ?? 0) + e.qty)
        return [...byLine].map(([boq_line_item_id, total_qty]) => ({ boq_line_item_id, total_qty }))
      }
      const latest = new Map<string, Entry>()
      for (const e of [...mine].sort((a, b) => (a.date < b.date ? 1 : -1))) if (!latest.has(e.lineId)) latest.set(e.lineId, e)
      return [...latest.values()].map((e) => ({ boq_line_item_id: e.lineId, percent_complete: e.percent, entry_date: e.date }))
    },
  }
}

async function runReport(db: unknown) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_c: unknown, fn: (d: unknown) => Promise<unknown>) => fn(db)),
  }))
  await mock.module("./construction-enablement-service", () => ({ ...realEnablement, requireConstructionEnabled: mock(async () => {}) }))
  const service = await import("./construction-reports-service")
  service.__resetConstructionEnablementMemo()
  return service.earnedValueReport({ orgId: "org-1" }, "p1")
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./construction-enablement-service", () => realEnablement)
})

const threeDeltasOn11: Entry[] = [
  { lineId: "v1-11", basis: "DELTA", qty: 10, percent: 20, date: "2026-10-01" },
  { lineId: "v1-11", basis: "DELTA", qty: 10, percent: 40, date: "2026-10-02" },
  { lineId: "v1-11", basis: "DELTA", qty: 10, percent: 60, date: "2026-10-03" },
]
const revisedBoqs = [{ id: V2, status: "draft", version: 2 }, { id: V1, status: "superseded", version: 1 }]

describe("R-51/R-52: earnedValueReport after a BOQ revision", () => {
  test("progress logged on the superseded revision still counts on the latest revision (was 0%)", async () => {
    const result = await runReport(makeDb(revisedBoqs, [...v1Lines, ...v2Lines], threeDeltasOn11))
    // 30 units x rate 90 x 50/100 = 1,350 earned; contract = latest revision only.
    expect(result.contractValue).toBe(9000)
    expect(result.earnedValue).toBe(1350)
    expect(result.percentByValue).toBe(15)
  })

  test("a revision with NO progress anywhere stays at 0", async () => {
    const result = await runReport(makeDb(revisedBoqs, [...v1Lines, ...v2Lines], []))
    expect(result).toEqual({ earnedValue: 0, contractValue: 9000, percentByValue: 0 })
  })

  test("a fresh, never-revised BOQ is unchanged: progress on its own lines counts as before", async () => {
    const result = await runReport(makeDb([{ id: V1, status: "draft", version: 1 }], v1Lines, threeDeltasOn11))
    expect(result.contractValue).toBe(7000)
    expect(result.earnedValue).toBe(1050) // 30 x 70 x 50/100
  })

  test("progress on the current revision is added to what carried over", async () => {
    const result = await runReport(
      makeDb(revisedBoqs, [...v1Lines, ...v2Lines], [...threeDeltasOn11, { lineId: "v2-11", basis: "DELTA", qty: 10, percent: 80, date: "2026-10-10" }])
    )
    expect(result.earnedValue).toBe(1800) // 40 x 90 x 50/100
  })
})

describe("foldProgressAcrossRevisions", () => {
  const row = (over: Partial<ProgressSourceRow>): ProgressSourceRow => ({ lineId: "v1-11", boqId: V1, itemCode: "1.1", qty: 0, percent: null, percentDate: null, ...over })

  test("matches by trimmed, case-insensitive item code; sums quantity; latest percent by date wins", () => {
    const { qtyByItem, latestPercentByItem } = foldProgressAcrossRevisions(
      [{ id: "v2-a", boqId: V2, itemCode: " A-1 " }],
      [
        row({ lineId: "x", itemCode: "a-1", qty: 4, percent: 10, percentDate: "2026-10-01" }),
        row({ lineId: "y", boqId: "boq-v0", itemCode: "A-1", qty: 6, percent: 30, percentDate: "2026-10-05" }),
      ]
    )
    expect(qtyByItem.get("v2-a")).toBe(10)
    expect(latestPercentByItem.get("v2-a")).toBe(30)
  })

  test("a line with no code never matches another revision's lines", () => {
    const { qtyByItem } = foldProgressAcrossRevisions([{ id: "v2-a", boqId: V2, itemCode: null }], [row({ itemCode: null, qty: 9 })])
    expect(qtyByItem.has("v2-a")).toBe(false)
  })

  test("two lines sharing a code inside ONE revision do not leak into each other", () => {
    const { qtyByItem } = foldProgressAcrossRevisions(
      [{ id: "c1", boqId: V2, itemCode: "7" }, { id: "c2", boqId: V2, itemCode: "7" }],
      [row({ lineId: "c1", boqId: V2, itemCode: "7", qty: 5 })]
    )
    expect(qtyByItem.get("c1")).toBe(5)
    expect(qtyByItem.has("c2")).toBe(false)
  })
})
