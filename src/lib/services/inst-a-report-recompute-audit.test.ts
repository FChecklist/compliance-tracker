/// <reference types="bun-types" />
// INST-A -- independent recompute + date-boundary audit for the reports
// module (D28 DOD-P1, DOD-P3). PM-assigned, W-GAP, window W20260910-1302.
//
// DOD-P1 ("every figure computed independently, compared against the
// report's output"): this file recomputes earnedValueReport's percentByValue
// via a SEPARATELY AUTHORED implementation (not importing computeEarnedValue)
// against a real project's real BOQ + progress data, then compares the two.
// A real independent recompute, not a second call to the same function.
//
// DOD-P3 ("filters and date ranges function, tested at boundaries"): drives
// attendanceReport's dateFrom/dateTo across exact-start, exact-end, a
// single-day range (from===to), and an empty (undefined/undefined) range,
// against real attendance data, and asserts the boundary is INCLUSIVE
// (gte/lte, per the source) and that counts sum correctly across the splits.
//
// D58: an audit instrument earns no trust from a clean/matching result alone.
// The two ".failsOnPlantedDefect" tests below deliberately corrupt an input
// the audit is supposed to catch, and assert the mismatch is actually
// reported -- proving the comparison discriminates before any clean pass is
// banked as evidence.
//
// Same real-DB pattern as erp-goods-receipt-nested-transaction.test.ts: probe
// first, skip with a printed reason if unreachable, load .env.local
// explicitly (bun test does not read it under NODE_ENV=test).
import { describe, expect, test, beforeAll, setDefaultTimeout } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

setDefaultTimeout(120_000)

const REPO_ROOT = join(import.meta.dir, "..", "..", "..")

function loadDbEnvFromEnvLocalIfAbsent(): void {
  const path = join(REPO_ROOT, ".env.local")
  if (!existsSync(path)) return
  const wanted = new Set(["APP_RUNTIME_DATABASE_URL", "DATABASE_URL"])
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    if (!wanted.has(key) || process.env[key]) continue
    let value = match[2].trim()
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    if (value.length > 0) process.env[key] = value
  }
}
loadDbEnvFromEnvLocalIfAbsent()

const ORG_ID = "projexa_demo_org"
const PROJECT_ID = "projexa_demo_project"

async function probeDatabase(): Promise<string | null> {
  const url = process.env.APP_RUNTIME_DATABASE_URL
  if (!url) return "APP_RUNTIME_DATABASE_URL is not set"
  const postgres = (await import("postgres")).default
  let lastError = "unknown error"
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(url, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 20, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return null
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : String(error)
      lastError = [code, message].filter((p) => p !== undefined && p !== "").join(" ") || "unknown error"
      try { await probe.end({ timeout: 5 }) } catch { /* ignore */ }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500))
    }
  }
  return `could not reach the database after 3 attempts: ${lastError}`
}

let skipReason: string | null = null
beforeAll(async () => {
  skipReason = await probeDatabase()
  if (skipReason) console.log(`[INST-A] SKIPPING -- ${skipReason}`)
})

/** INDEPENDENT reimplementation of computeEarnedValue's published formula
 *  (construction-reports-service.ts:774-830), authored separately from it,
 *  reading straight from raw rows so it shares no code path with the real
 *  function -- this is the "independent" half of DOD-P1. */
function independentEarnedValueRecompute(
  items: { id: string; parentLineItemId: string | null; amount: string | number; rate: string | number; breakdownPercentage: string | number | null }[],
  qtyByItem: Map<string, number>,
  pctByItem: Map<string, number>,
  corruptIgnoreMeasuredQty = false, // D58 falsification lever, see the failsOnPlantedDefect test
): { earnedValue: number; contractValue: number; percentByValue: number } {
  const lineEV = (id: string, rate: number, lineValue: number) => {
    const qty = qtyByItem.get(id) ?? 0
    if (qty > 0 && !corruptIgnoreMeasuredQty) return qty * rate
    const pct = pctByItem.get(id)
    return pct ? (pct / 100) * lineValue : 0
  }
  const children = new Map<string, typeof items>()
  for (const it of items) {
    if (it.parentLineItemId) {
      const list = children.get(it.parentLineItemId) ?? []
      list.push(it)
      children.set(it.parentLineItemId, list)
    }
  }
  let earned = 0
  let contract = 0
  for (const root of items.filter((i) => i.parentLineItemId === null)) {
    const amount = Number(root.amount)
    const rate = Number(root.rate)
    contract += amount
    earned += lineEV(root.id, rate, amount)
    for (const child of children.get(root.id) ?? []) {
      const bpct = Number(child.breakdownPercentage ?? 0)
      earned += lineEV(child.id, rate * (bpct / 100), amount * (bpct / 100))
    }
  }
  const percentByValue = contract > 0 ? Math.round((earned / contract) * 10000) / 100 : 0
  return { earnedValue: Math.round(earned * 100) / 100, contractValue: contract, percentByValue }
}

describe("INST-A -- reports-module independent recompute + date-boundary audit (DOD-P1, DOD-P3)", () => {
  test("DOD-P1: earnedValueReport's percentByValue matches an independently authored recompute against real data", async () => {
    if (skipReason) return
    const { earnedValueReport } = await import("./construction-reports-service")
    const { withTenantContext } = await import("../db/tenant-scoped")
    const { constructionBoqs, constructionBoqLineItems } = await import("../db/schema")
    const { eq, and, sql } = await import("drizzle-orm")

    const real = await earnedValueReport({ orgId: ORG_ID }, PROJECT_ID)

    const independent = await withTenantContext({ orgId: ORG_ID }, async (db) => {
      const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ORG_ID), eq(constructionBoqs.projectId, PROJECT_ID)), orderBy: (t: any, { desc }: any) => [desc(t.version), desc(t.createdAt)] })
      const latest = boqs.find((b: any) => b.status !== "superseded") ?? boqs[0]
      const items = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, latest.id) })
      const ids = items.map((i: any) => i.id)
      const idsSql = sql.join(ids.map((id: string) => sql`${id}`), sql`, `)
      const qtyRows = (await db.execute(sql`SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS q FROM compliance.construction_work_progress_entries WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) AND entry_basis = 'DELTA' GROUP BY boq_line_item_id`)) as any[]
      const pctRows = (await db.execute(sql`SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete FROM compliance.construction_work_progress_entries WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) ORDER BY boq_line_item_id, entry_date DESC`)) as any[]
      const qtyByItem = new Map(qtyRows.map((r) => [r.boq_line_item_id, Number(r.q)]))
      const pctByItem = new Map(pctRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))
      return independentEarnedValueRecompute(items as any, qtyByItem, pctByItem)
    })

    console.log(`[INST-A] real=${JSON.stringify(real)} independent=${JSON.stringify(independent)}`)
    expect(independent.percentByValue).toBeCloseTo(real.percentByValue, 2)
    expect(independent.earnedValue).toBeCloseTo(real.earnedValue, 2)
    expect(independent.contractValue).toBeCloseTo(real.contractValue, 2)
  })

  test("D58 falsifiability: the recompute DOES flag a planted defect (ignoring measured qty) rather than always agreeing", async () => {
    if (skipReason) return
    const { earnedValueReport } = await import("./construction-reports-service")
    const { withTenantContext } = await import("../db/tenant-scoped")
    const { constructionBoqs, constructionBoqLineItems } = await import("../db/schema")
    const { eq, and, sql } = await import("drizzle-orm")

    const real = await earnedValueReport({ orgId: ORG_ID }, PROJECT_ID)

    const corrupted = await withTenantContext({ orgId: ORG_ID }, async (db) => {
      const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ORG_ID), eq(constructionBoqs.projectId, PROJECT_ID)), orderBy: (t: any, { desc }: any) => [desc(t.version), desc(t.createdAt)] })
      const latest = boqs.find((b: any) => b.status !== "superseded") ?? boqs[0]
      const items = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, latest.id) })
      const ids = items.map((i: any) => i.id)
      const idsSql = sql.join(ids.map((id: string) => sql`${id}`), sql`, `)
      const qtyRows = (await db.execute(sql`SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS q FROM compliance.construction_work_progress_entries WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) AND entry_basis = 'DELTA' GROUP BY boq_line_item_id`)) as any[]
      const pctRows = (await db.execute(sql`SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete FROM compliance.construction_work_progress_entries WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) ORDER BY boq_line_item_id, entry_date DESC`)) as any[]
      const qtyByItem = new Map(qtyRows.map((r) => [r.boq_line_item_id, Number(r.q)]))
      const pctByItem = new Map(pctRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))
      // corruptIgnoreMeasuredQty=true -- deliberately WRONG, the planted defect.
      return independentEarnedValueRecompute(items as any, qtyByItem, pctByItem, true)
    })

    console.log(`[INST-A] real=${JSON.stringify(real)} corrupted=${JSON.stringify(corrupted)}`)
    // If this project has any item with a measured quantity > 0, the corrupted
    // recompute MUST diverge from the real figure -- if it doesn't, either the
    // project has no measured-quantity items (a setup problem) or the audit
    // has no discriminating power (a D58 problem). Fail loudly either way
    // rather than silently passing.
    expect(corrupted.percentByValue).not.toBeCloseTo(real.percentByValue, 2)
  })

  test("DOD-P3: attendanceReport's date range is boundary-correct (exact start/end, single-day, empty)", async () => {
    if (skipReason) return
    const { attendanceReport } = await import("./construction-reports-service")

    const full = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID) // empty range
    expect(full.workers.length).toBeGreaterThan(0)
    const totalDays = full.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    expect(totalDays).toBeGreaterThan(0)

    // Exact single-day range at the known min date (2026-07-06) -- inclusive
    // gte/lte per source, so from===to must return exactly that day's rows.
    const singleDay = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2026-07-06", "2026-07-06")
    const singleDayCount = singleDay.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    expect(singleDayCount).toBeGreaterThan(0)
    expect(singleDayCount).toBeLessThanOrEqual(totalDays)

    // Exact-boundary split: [min, min] + (min, max] must reconstruct the full total.
    const rest = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2026-07-07", "2026-07-13")
    const restCount = rest.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    expect(singleDayCount + restCount).toBe(totalDays)

    // Exact-end boundary: a range ending exactly on the max date must include it.
    const toMax = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2026-07-06", "2026-07-13")
    const toMaxCount = toMax.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    expect(toMaxCount).toBe(totalDays)

    // A range entirely before any data returns zero rows without throwing.
    const empty = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2020-01-01", "2020-01-02")
    expect(empty.workers.length).toBe(0)
  })

  test("D58 falsifiability: the boundary audit DOES fail when a range is deliberately mis-split (off-by-one)", async () => {
    if (skipReason) return
    const { attendanceReport } = await import("./construction-reports-service")
    const full = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID)
    const totalDays = full.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)

    // Planted defect: split at 2026-07-07/2026-07-07 + 2026-07-07/2026-07-13
    // deliberately DOUBLE-COUNTS 07-07 on both sides of the boundary. A
    // correct boundary check must catch this as NOT reconstructing the total.
    const a = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2026-07-06", "2026-07-07")
    const b = await attendanceReport({ orgId: ORG_ID }, PROJECT_ID, "2026-07-07", "2026-07-13")
    const aCount = a.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    const bCount = b.workers.reduce((s, w) => s + w.daysPresent + w.daysHalf + w.daysAbsent, 0)
    console.log(`[INST-A] deliberately overlapping split: a=${aCount} b=${bCount} sum=${aCount + bCount} total=${totalDays}`)
    expect(aCount + bCount).not.toBe(totalDays) // must NOT reconcile -- proves the check has teeth
  })
})
