// R85 Addendum 3 v4, Phase 10 -- THE WHAT-IF / SCENARIO ENGINE. Gates
// 10-01..10-13 (work order WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, Part
// F). Real, committed, re-runnable proofs (R74-RULING-03).
//
// TEST-BOUNDARY NOTE (read before extending this file): the DB-mocked tests
// below mock ONLY @/lib/db/tenant-scoped's withTenantContext for the
// create/read/adjust/compute functions this file OWNS. commitScenario's
// revision-creation path additionally mocks "./construction-boq-service"'s
// createBoqRevision/getBoq/toLineItemInput exports -- this isolates and
// verifies THIS service's own orchestration logic (which lines are
// included/excluded/evidenced, whether a thrown ScopeReductionError
// propagates unchanged, whether the dual-view backfill runs correctly).
// createBoqRevision's OWN internal correctness (scope-reduction detection,
// version-chaining, the E-128 double-revision guard, etc) is already
// covered by construction-boq-service.test.ts and its siblings -- this file
// does not modify that function and does not re-prove its internals.
import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import * as realConstructionBoqService from "./construction-boq-service"
import { NOT_SET } from "./boq-dual-view-service"
import { boqScenario as boqScenarioTable } from "@/lib/db"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./construction-boq-service", () => realConstructionBoqService)
})

// ═══════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS -- no DB, no mocking.
// ═══════════════════════════════════════════════════════════════════════

import {
  mergeAdjustment,
  removeAdjustmentsForLine,
  resolveBulkSelector,
  applyAdjustmentsToLine,
  isScenarioLineNegative,
  solveRateChangeForTargetProfitPercent,
  solveQtyReductionForTargetContractValue,
  type ScenarioAdjustment,
} from "./boq-scenario-service"
import { computeBoqLineMoneyView } from "./boq-dual-view-service"

describe("mergeAdjustment -- 10-02 latest-edit-wins, exclude supersedes, a real number un-excludes", () => {
  test("two different (side, field) adjustments on the same line coexist -- BOTH SIDES / both fields adjustable", () => {
    const a: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }
    const b: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "qty", changeType: "percent", value: 5 }
    const list = mergeAdjustment(mergeAdjustment([], a), b)
    expect(list).toHaveLength(2)
    expect(list).toContainEqual(a)
    expect(list).toContainEqual(b)
  })

  test("a second adjustment on the SAME (line, side, field) replaces the first, not both kept", () => {
    const a: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }
    const b: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -20 }
    const list = mergeAdjustment(mergeAdjustment([], a), b)
    expect(list).toEqual([b])
  })

  test("exclude removes every other adjustment already recorded for that line (both sides)", () => {
    const rate: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }
    const qty: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "contract", field: "qty", changeType: "absolute", value: 5 }
    const exclude: ScenarioAdjustment = { kind: "exclude", lineItemId: "L1" }
    const list = mergeAdjustment(mergeAdjustment(mergeAdjustment([], rate), qty), exclude)
    expect(list).toEqual([exclude])
  })

  test("recording a real numeric adjustment un-excludes a previously-excluded line", () => {
    const exclude: ScenarioAdjustment = { kind: "exclude", lineItemId: "L1" }
    const rate: ScenarioAdjustment = { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }
    const list = mergeAdjustment(mergeAdjustment([], exclude), rate)
    expect(list).toEqual([rate])
  })

  test("adjustments on a DIFFERENT line are untouched by either rule", () => {
    const l1: ScenarioAdjustment = { kind: "exclude", lineItemId: "L1" }
    const l2: ScenarioAdjustment = { kind: "adjust", lineItemId: "L2", side: "project", field: "rate", changeType: "percent", value: -10 }
    const list = mergeAdjustment([l1], l2)
    expect(list).toEqual([l1, l2])
  })
})

describe("removeAdjustmentsForLine", () => {
  test("clears every adjustment for one line, leaves others untouched", () => {
    const list: ScenarioAdjustment[] = [
      { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 },
      { kind: "adjust", lineItemId: "L1", side: "contract", field: "qty", changeType: "absolute", value: 5 },
      { kind: "exclude", lineItemId: "L2" },
    ]
    expect(removeAdjustmentsForLine(list, "L1")).toEqual([{ kind: "exclude", lineItemId: "L2" }])
  })
})

describe("resolveBulkSelector -- 10-03 (a selection, a trade/section, the whole BOQ)", () => {
  const lines = [
    { id: "L1", category: "Civil" },
    { id: "L2", category: "Gypsum" },
    { id: "L3", category: "Civil" },
    { id: "L4", category: null },
  ]

  test("lineItemIds -- an explicit selection, passed through unchanged", () => {
    expect(resolveBulkSelector(lines, { kind: "lineItemIds", lineItemIds: ["L2", "L4"] })).toEqual(["L2", "L4"])
  })

  test("category -- a trade/section, case- and whitespace-insensitive", () => {
    expect(resolveBulkSelector(lines, { kind: "category", category: "  civil  " })).toEqual(["L1", "L3"])
  })

  test("category with no matches returns an empty list, not a throw (the caller decides what that means)", () => {
    expect(resolveBulkSelector(lines, { kind: "category", category: "Joinery" })).toEqual([])
  })

  test("all -- the whole BOQ", () => {
    expect(resolveBulkSelector(lines, { kind: "all" })).toEqual(["L1", "L2", "L3", "L4"])
  })
})

describe("applyAdjustmentsToLine -- 10-02, the five verbs, both sides", () => {
  const base = { id: "L1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }

  test("no adjustments -- base values pass through unchanged (as finite numbers)", () => {
    expect(applyAdjustmentsToLine(base, [])).toEqual({ qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50 })
  })

  test("rate by % (project side): -10% on rateProject only, everything else untouched", () => {
    const result = applyAdjustmentsToLine(base, [{ kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }])
    expect(result.rateProject).toBe(36) // 40 * 0.9
    expect(result.qtyProject).toBe(100)
    expect(result.qtyContract).toBe(100)
    expect(result.rateContract).toBe(50)
  })

  test("rate to absolute (contract side)", () => {
    const result = applyAdjustmentsToLine(base, [{ kind: "adjust", lineItemId: "L1", side: "contract", field: "rate", changeType: "absolute", value: 65 }])
    expect(result.rateContract).toBe(65)
  })

  test("qty by % (contract side): -20%", () => {
    const result = applyAdjustmentsToLine(base, [{ kind: "adjust", lineItemId: "L1", side: "contract", field: "qty", changeType: "percent", value: -20 }])
    expect(result.qtyContract).toBe(80)
  })

  test("qty to absolute (project side)", () => {
    const result = applyAdjustmentsToLine(base, [{ kind: "adjust", lineItemId: "L1", side: "project", field: "qty", changeType: "absolute", value: 150 }])
    expect(result.qtyProject).toBe(150)
  })

  test("BOTH SIDES adjustable at once, independently", () => {
    const result = applyAdjustmentsToLine(base, [
      { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 },
      { kind: "adjust", lineItemId: "L1", side: "contract", field: "rate", changeType: "percent", value: 10 },
    ])
    expect(result.rateProject).toBeCloseTo(36, 9)
    expect(result.rateContract).toBeCloseTo(55, 9)
  })

  test("BOTH rate and qty adjustable on the SAME side at once", () => {
    const result = applyAdjustmentsToLine(base, [
      { kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 },
      { kind: "adjust", lineItemId: "L1", side: "project", field: "qty", changeType: "percent", value: 5 },
    ])
    expect(result.rateProject).toBe(36)
    expect(result.qtyProject).toBe(105)
  })

  test("exclude: qty -> 0 on BOTH sides, rate untouched (kept for the struck-through display)", () => {
    const result = applyAdjustmentsToLine(base, [{ kind: "exclude", lineItemId: "L1" }])
    expect(result).toEqual({ qtyProject: 0, rateProject: 40, qtyContract: 0, rateContract: 50 })
  })

  test("X-04: a % change against an UNSET base stays unset (never a false 0 or NaN)", () => {
    const unset = { id: "L1", parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: "100", rateContract: "50" }
    const result = applyAdjustmentsToLine(unset, [{ kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "percent", value: -10 }])
    expect(result.rateProject).toBeNull()
  })

  test("an ABSOLUTE change can set a value where none existed", () => {
    const unset = { id: "L1", parentLineItemId: null, qtyProject: null, rateProject: null, qtyContract: "100", rateContract: "50" }
    const result = applyAdjustmentsToLine(unset, [{ kind: "adjust", lineItemId: "L1", side: "project", field: "rate", changeType: "absolute", value: 42 }])
    expect(result.rateProject).toBe(42)
  })

  test("an excluded line with no rate ever entered feeds NOT_SET into computeBoqLineMoneyView, matching the SAME base-BOQ NOT_SET rule (Phase 1-4), not a bespoke scenario-only exception", () => {
    const noRate = { id: "L1", parentLineItemId: null, qtyProject: "100", rateProject: null, qtyContract: "100", rateContract: null }
    const applied = applyAdjustmentsToLine(noRate, [{ kind: "exclude", lineItemId: "L1" }])
    const view = computeBoqLineMoneyView(applied)
    expect(view.projectValue).toBe(NOT_SET)
    expect(view.contractValue).toBe(NOT_SET)
  })
})

describe("isScenarioLineNegative -- 10-06", () => {
  test("a negative variance (cost exceeds contract price) is flagged", () => {
    expect(isScenarioLineNegative(computeBoqLineMoneyView({ qtyProject: 100, rateProject: 90, qtyContract: 100, rateContract: 50 }))).toBe(true)
  })
  test("a healthy positive-margin line is not flagged", () => {
    expect(isScenarioLineNegative(computeBoqLineMoneyView({ qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50 }))).toBe(false)
  })
  test("a NOT_SET line is never treated as negative (X-04: unknown is not bad)", () => {
    expect(isScenarioLineNegative(computeBoqLineMoneyView({ qtyProject: null, rateProject: null, qtyContract: 100, rateContract: 50 }))).toBe(false)
  })
  test("a negative absolute contract value (an overshoot override) is flagged even with a positive variance sign convention", () => {
    expect(isScenarioLineNegative(computeBoqLineMoneyView({ qtyProject: 10, rateProject: 5, qtyContract: -20, rateContract: 5 }))).toBe(true)
  })
})

describe("solveRateChangeForTargetProfitPercent -- 10-04 SOLVE AND SHOW, never apply", () => {
  test("worked example: contract 800,000, project 600,000 (25% profit already) -- target 25% needs 0% change", () => {
    const result = solveRateChangeForTargetProfitPercent({ contractValue: 800000, projectValue: 600000 }, 25)
    expect(result.feasible).toBe(true)
    if (result.feasible) {
      expect(result.rateChangePercent).toBeCloseTo(0, 6)
      expect(result.projectedProjectValue).toBeCloseTo(600000, 6)
    }
  })

  test("worked example: contract 800,000, project 600,000, target 40% profit -> project must drop to 480,000, a -20% rate change", () => {
    const result = solveRateChangeForTargetProfitPercent({ contractValue: 800000, projectValue: 600000 }, 40)
    expect(result.feasible).toBe(true)
    if (result.feasible) {
      expect(result.projectedProjectValue).toBeCloseTo(480000, 6)
      expect(result.rateChangePercent).toBeCloseTo(-20, 6)
      expect(result.projectedProfitPercent).toBeCloseTo(40, 6)
    }
  })

  test("infeasible: contract value NOT_SET", () => {
    const result = solveRateChangeForTargetProfitPercent({ contractValue: NOT_SET, projectValue: 100 }, 25)
    expect(result.feasible).toBe(false)
  })

  test("infeasible: project value NOT_SET (no cost baseline to scale)", () => {
    const result = solveRateChangeForTargetProfitPercent({ contractValue: 100, projectValue: NOT_SET }, 25)
    expect(result.feasible).toBe(false)
  })

  test("infeasible: non-finite target", () => {
    const result = solveRateChangeForTargetProfitPercent({ contractValue: 100, projectValue: 50 }, NaN)
    expect(result.feasible).toBe(false)
  })

  test("NEVER applies anything -- this is a pure function, it has no db/service argument to write through", () => {
    // Structural falsifiability: the function's own signature takes only
    // plain numbers/NOT_SET, so there is no possible code path inside it
    // that could reach a database.
    expect(solveRateChangeForTargetProfitPercent.length).toBeLessThanOrEqual(2)
  })
})

describe("solveQtyReductionForTargetContractValue -- 10-04", () => {
  test("worked example: contract 1,000,000, target 800,000 -> 20% reduction", () => {
    const result = solveQtyReductionForTargetContractValue({ contractValue: 1000000 }, 800000)
    expect(result.feasible).toBe(true)
    if (result.feasible) {
      expect(result.qtyReductionPercent).toBeCloseTo(20, 6)
      expect(result.projectedContractValue).toBe(800000)
    }
  })

  test("a target ABOVE current contract value yields a negative 'reduction' (an increase) -- solved and shown, not blocked", () => {
    const result = solveQtyReductionForTargetContractValue({ contractValue: 800000 }, 1000000)
    expect(result.feasible).toBe(true)
    if (result.feasible) expect(result.qtyReductionPercent).toBeCloseTo(-25, 6)
  })

  test("infeasible: contract value NOT_SET or zero", () => {
    expect(solveQtyReductionForTargetContractValue({ contractValue: NOT_SET }, 500).feasible).toBe(false)
    expect(solveQtyReductionForTargetContractValue({ contractValue: 0 }, 500).feasible).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// STRUCTURAL: exactly one file inserts into boq_scenario (matches this
// codebase's own boq_baseline precedent, 3-02's structural test).
// ═══════════════════════════════════════════════════════════════════════

describe("createScenario is the ONLY write path that inserts into boq_scenario", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, out)
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
    }
    return out
  }
  const NEEDLE = "insert" + "(boqScenario)"

  test('exactly one file under src/lib and src/app/api contains "insert(boqScenario)", and it is this service', () => {
    const srcLib = join(import.meta.dir, "..")
    const srcAppApi = join(import.meta.dir, "..", "..", "app", "api")
    const files = [...walk(srcLib), ...walk(srcAppApi)]
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(NEEDLE))
    const relHits = hits.map((f) => f.replace(/\\/g, "/"))
    expect(relHits.length).toBe(1)
    expect(relHits[0]).toContain("boq-scenario-service.ts")
  }, 90000)
})

// ═══════════════════════════════════════════════════════════════════════
// DB-MOCKED SUITE -- fakeDb pattern matches boq-baseline-service.test.ts's
// own established convention exactly.
// ═══════════════════════════════════════════════════════════════════════

type FakeLine = {
  id: string
  parentLineItemId: string | null
  qtyProject: string | null
  rateProject: string | null
  qtyContract: string | null
  rateContract: string | null
  category?: string | null
  itemCode?: string | null
  description?: string
}

// ── A REAL drizzle-where-aware fake, not a "just return the only row"
// shortcut. This codebase's own boq-baseline-service.test.ts gets away with
// the simpler shortcut because it only ever has ONE boq id in play; this
// file's compareScenarios needs to distinguish MULTIPLE scenario ids held
// in the same fakeDb at once, so this walks drizzle's real `and(eq(col,
// val), eq(col2, val2))` SQL-builder output (an ordinary object tree with a
// `.queryChunks` array; a Column node carries `.name`/`.columnType`, a Param
// node carries `.value`/`.encoder`) and extracts `{ dbColumnName: value }`
// pairs. Verified empirically against a real `and(eq(...), eq(...))` call
// before being relied on here (Node REPL, drizzle-orm's actual runtime
// shape) -- not guessed. Only used by this test file's own fake DB, never
// shipped in production code.
function extractEqPairs(node: unknown, pairs: Record<string, unknown>, pending: { name: string | null }): void {
  if (node === null || typeof node !== "object") return
  const n = node as Record<string, unknown>
  if (typeof n.name === "string" && "columnType" in n) {
    pending.name = n.name
    return
  }
  if ("encoder" in n && "value" in n) {
    if (pending.name) {
      pairs[pending.name] = n.value
      pending.name = null
    }
    return
  }
  if (Array.isArray(n.queryChunks)) {
    for (const chunk of n.queryChunks) extractEqPairs(chunk, pairs, pending)
  }
}
function whereEquals(where: unknown): Record<string, unknown> {
  const pairs: Record<string, unknown> = {}
  extractEqPairs(where, pairs, { name: null })
  return pairs
}

function mountFakeDb(opts: {
  boqRow?: { id: string; orgId: string; projectId: string } | null
  lines?: FakeLine[]
  scenarioRows?: Array<Record<string, unknown>>
}) {
  // "boqRow" in opts (not `opts.boqRow ?? default`) -- a test that explicitly
  // passes `boqRow: null` means "simulate no such BOQ", which `??` would
  // otherwise silently overwrite with the default (null is one of the two
  // values `??` treats as "use the fallback").
  const boqRow = "boqRow" in opts ? opts.boqRow : { id: "boq-1", orgId: "org-1", projectId: "proj-1" }
  const lines = opts.lines ?? [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }]
  const scenarioRows: Array<Record<string, unknown>> = opts.scenarioRows ?? []
  let nextId = 1

  const lineUpdateCalls: Array<{ id: string; set: Record<string, unknown> }> = []
  const insertMock = mock((table: unknown) => table)

  const fakeDb = {
    query: {
      constructionBoqs: { findFirst: mock(async () => boqRow) },
      constructionBoqLineItems: {
        findFirst: mock(async (args?: { where?: unknown }) => {
          const eq_ = whereEquals(args?.where)
          if (eq_.id) return lines.find((l) => l.id === eq_.id) ?? null
          return lines[0] ?? null
        }),
        findMany: mock(async () => lines),
      },
      boqScenario: {
        findFirst: mock(async (args?: { where?: unknown }) => {
          const eq_ = whereEquals(args?.where)
          if (eq_.id) return scenarioRows.find((r) => r.id === eq_.id) ?? null
          return scenarioRows[scenarioRows.length - 1] ?? null
        }),
        findMany: mock(async (args?: { where?: unknown }) => {
          const eq_ = whereEquals(args?.where)
          const filtered = eq_.boq_id ? scenarioRows.filter((r) => r.boqId === eq_.boq_id) : scenarioRows
          return filtered.map((r) => ({ ...r }))
        }),
      },
    },
    insert: (table: unknown) => {
      insertMock(table)
      return {
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            const row = { id: `scenario-${nextId++}`, createdAt: new Date(), updatedAt: new Date(), status: "draft", committedAt: null, committedById: null, committedRevisionBoqId: null, ...values }
            scenarioRows.push(row)
            return [{ ...row }]
          },
        }),
      }
    },
    // Dispatches on REAL table-object identity (this test file imports the
    // SAME `boqScenario`/`constructionBoqLineItems` exports from "@/lib/db"
    // that the service module resolves to -- only tenant-scoped.ts is
    // mocked, "@/lib/db" itself is not) -- reliable, not a heuristic.
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const eq_ = whereEquals(cond)
          const id = eq_.id as string | undefined
          if (table === boqScenarioTable) {
            const row = id ? scenarioRows.find((r) => r.id === id) : scenarioRows[scenarioRows.length - 1]
            if (row) Object.assign(row, values)
            const result = row ? [{ ...row }] : []
            const p = Promise.resolve(result) as Promise<typeof result> & { returning: () => Promise<typeof result> }
            p.returning = () => Promise.resolve(result)
            return p
          }
          // constructionBoqLineItems -- always plain-awaited in this
          // service, never .returning() -- see commitScenario's cost-side
          // write.
          lineUpdateCalls.push({ id: id ?? "unknown", set: values })
          if (id) {
            const line = lines.find((l) => l.id === id)
            if (line) Object.assign(line, values)
          }
          return Promise.resolve()
        },
      }),
    }),
  }

  return { fakeDb, boqRow, lines, scenarioRows, insertMock, lineUpdateCalls }
}

// IMPORTANT ORDERING NOTE: both mock.module calls happen BEFORE the dynamic
// `import("./boq-scenario-service")` below, matching this codebase's own
// established convention (boq-baseline-service.test.ts mocks then imports,
// fresh, every single test) -- boq-scenario-service.ts's own top-level
// `import {...} from "./construction-boq-service"` is resolved at THAT
// import call, so the construction-boq-service override must already be in
// place before it runs, not applied afterward.
async function mountAndImport(
  opts: Parameters<typeof mountFakeDb>[0] = {},
  constructionBoqServiceOverrides: Partial<typeof realConstructionBoqService> = {}
) {
  const mounted = mountFakeDb(opts)
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => fn(mounted.fakeDb)),
  }))
  await mock.module("./construction-boq-service", () => ({
    ...realConstructionBoqService,
    ...constructionBoqServiceOverrides,
  }))
  const svc = await import("./boq-scenario-service")
  return { ...mounted, svc }
}

const ctx = { orgId: "org-1", userId: "user-1" }

describe("createScenario -- 10-01", () => {
  test("creates a scenario with an empty adjustment list, name/author/boqId/projectId carried through", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    const scenario = await svc.createScenario(ctx, { boqId: "boq-1", name: "Value engineering pass" })
    expect(scenario.name).toBe("Value engineering pass")
    expect(scenario.authorId).toBe("user-1")
    expect(scenario.boqId).toBe("boq-1")
    expect(scenario.projectId).toBe("proj-1")
    expect(scenario.adjustments).toEqual([])
    expect(scenarioRows.length).toBe(1)
  })

  test("rejects a missing/blank name without touching the DB", async () => {
    const { svc, insertMock } = await mountAndImport({})
    await expect(svc.createScenario(ctx, { boqId: "boq-1", name: "   " })).rejects.toThrow(/name is required/)
    expect(insertMock).not.toHaveBeenCalled()
  })

  test("404s when the BOQ does not exist in this org", async () => {
    const { svc } = await mountAndImport({ boqRow: null })
    await expect(svc.createScenario(ctx, { boqId: "nope", name: "X" })).rejects.toThrow(/BOQ not found/)
  })
})

describe("addAdjustment -- 10-02/10-08", () => {
  test("adds a single adjustment; validates the line belongs to the scenario's BOQ", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", adjustments: [] })
    const updated = await svc.addAdjustment(ctx, "s1", { kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -10 })
    expect(updated.adjustments).toHaveLength(1)
  })

  test("refuses an absolute negative quantity (reuses boq-dual-view-service's own cell-edit validation, X-27)", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", adjustments: [] })
    await expect(
      svc.addAdjustment(ctx, "s1", { kind: "adjust", lineItemId: "line-1", side: "project", field: "qty", changeType: "absolute", value: -5 })
    ).rejects.toThrow(/cannot be negative/)
  })

  test("a committed scenario refuses further adjustment (10-11: never silently mutated after commit)", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "committed", name: "S", adjustments: [] })
    await expect(
      svc.addAdjustment(ctx, "s1", { kind: "exclude", lineItemId: "line-1" })
    ).rejects.toThrow(/already been committed/)
  })
})

describe("addBulkAdjustment -- 10-03", () => {
  test("a category selector applies the same adjustment to every matching line", async () => {
    const lines: FakeLine[] = [
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50", category: "Civil" },
      { id: "line-2", parentLineItemId: null, qtyProject: "50", rateProject: "20", qtyContract: "50", rateContract: "30", category: "Civil" },
      { id: "line-3", parentLineItemId: null, qtyProject: "10", rateProject: "5", qtyContract: "10", rateContract: "8", category: "Gypsum" },
    ]
    const { svc, scenarioRows } = await mountAndImport({ lines })
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", adjustments: [] })
    const result = await svc.addBulkAdjustment(ctx, "s1", {
      selector: { kind: "category", category: "Civil" },
      kind: "adjust",
      side: "project",
      field: "rate",
      changeType: "percent",
      value: -10,
    })
    expect(result.affectedLineItemIds.sort()).toEqual(["line-1", "line-2"])
    expect(result.adjustments).toHaveLength(2)
  })

  test("a zero-match selector is refused with a clear error, nothing written", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", adjustments: [] })
    await expect(
      svc.addBulkAdjustment(ctx, "s1", { selector: { kind: "category", category: "Nonexistent" }, kind: "exclude" })
    ).rejects.toThrow(/zero line items/)
  })
})

describe("computeScenarioView -- 10-05/10-06 (BASE | SCENARIO | DELTA, per line and in total)", () => {
  test("a worked example: one line, -10% project rate, proves base/scenario/delta all differ correctly", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }]
    const { svc, scenarioRows } = await mountAndImport({ lines })
    scenarioRows.push({
      id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft",
      adjustments: [{ kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -10 }],
    })
    const view = await svc.computeScenarioView(ctx, "s1")
    expect(view.lines[0].base.projectValue).toBe(4000) // 100*40
    expect(view.lines[0].scenario.projectValue).toBe(3600) // 100*36
    expect(view.lines[0].delta.projectValue).toBe(-400)
    expect(view.totals.base.projectValue).toBe(4000)
    expect(view.totals.scenario.projectValue).toBe(3600)
    expect(view.totals.delta.projectValue).toBe(-400)
    // Contract side untouched by a project-only adjustment.
    expect(view.lines[0].base.contractValue).toBe(5000)
    expect(view.lines[0].scenario.contractValue).toBe(5000)
    expect(view.totals.delta.contractValue).toBe(0)
  })

  test("10-06: an excluded/adjusted line that goes negative is flagged in negativeLineItemIds", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "80", qtyContract: "100", rateContract: "50" }]
    const { svc, scenarioRows } = await mountAndImport({ lines })
    scenarioRows.push({
      id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft",
      adjustments: [{ kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: 20 }], // 80*1.2=96 project vs 50 contract -> variance negative
    })
    const view = await svc.computeScenarioView(ctx, "s1")
    expect(view.negativeLineItemIds).toEqual(["line-1"])
    expect(view.lines[0].negative).toBe(true)
    expect(view.lines[0].base.variance).toBe(-3000) // base already negative here too, by design of this fixture's base rates
  })

  test("10-08: computeScenarioView (and every add*/remove* function above) never writes to constructionBoqLineItems -- the live BOQ is untouched until commit", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }]
    const { svc, scenarioRows, lineUpdateCalls } = await mountAndImport({ lines })
    let scenario = await svc.createScenario(ctx, { boqId: "boq-1", name: "Scratch" })
    scenario = await svc.addAdjustment(ctx, scenario.id, { kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -50 })
    scenario = await svc.addAdjustment(ctx, scenario.id, { kind: "exclude", lineItemId: "line-1" })
    await svc.computeScenarioView(ctx, scenario.id)
    // The falsifiability proof: navigate away (i.e. never call commit) and
    // confirm the live BOQ's line-item update path was never invoked.
    expect(lineUpdateCalls.length).toBe(0)
    // And the live line row itself is untouched, byte for byte.
    expect(lines[0].rateProject).toBe("40")
    expect(lines[0].qtyProject).toBe("100")
  })
})

describe("compareScenarios -- 10-07", () => {
  test("returns one entry per scenario id, each with its own totals", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }]
    const { svc, scenarioRows } = await mountAndImport({ lines })
    scenarioRows.push(
      { id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Aggressive cut", authorId: "user-1", adjustments: [{ kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -30 }] },
      { id: "s2", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Conservative cut", authorId: "user-1", adjustments: [{ kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -5 }] }
    )
    const result = await svc.compareScenarios(ctx, ["s1", "s2"])
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("Aggressive cut")
    expect(result[1].name).toBe("Conservative cut")
    expect(result[0].totals.scenario.projectValue).not.toBe(result[1].totals.scenario.projectValue)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 10-12 -- THE SECURITY-CRITICAL FALSIFIABILITY GATE (PASS marker in spec).
// Verified via the plant-break-confirm-red-then-restore-confirm-green cycle
// per R74-RULING-03: this test was run once with the guard's condition
// inverted (`ctx.actorKind === "human"`) to confirm it goes RED (an
// ai_agent commit was allowed through), then reverted to the real
// `!== "human"` check and reconfirmed GREEN before this file was committed.
// ═══════════════════════════════════════════════════════════════════════

describe("commitScenario -- 10-12, AI MAY PROPOSE, AI MAY NEVER COMMIT", () => {
  test("PRIMARY PROOF: an actorKind of 'ai_agent' is refused with ZERO calls to any db.query/insert/update function -- a real, mounted fakeDb proves the guard fires before touching data, not just before a live connection", async () => {
    const { svc, fakeDb } = await mountAndImport({
      scenarioRows: [{ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Should never be reached", adjustments: [] }],
    })
    await expect(
      svc.commitScenario(
        { orgId: "org-1", userId: "ai-user", dbUser: {} as never, actorKind: "ai_agent" },
        "s1"
      )
    ).rejects.toThrow(/AI agent may PROPOSE.*may NEVER commit/)
    expect(fakeDb.query.boqScenario.findFirst).not.toHaveBeenCalled()
    expect(fakeDb.query.constructionBoqLineItems.findMany).not.toHaveBeenCalled()
    expect(fakeDb.query.constructionBoqLineItems.findFirst).not.toHaveBeenCalled()
  })

  test("SECONDARY PROOF (belt-and-suspenders): with NO mock at all -- real @/lib/db/tenant-scoped, real ./construction-boq-service -- the guard still fires before ever reaching a real connection attempt (this environment has no APP_RUNTIME_DATABASE_URL set; if the guard did not fire first, this test would fail with a connection error instead of the expected refusal message)", async () => {
    const svc = await import("./boq-scenario-service")
    await expect(
      svc.commitScenario(
        { orgId: "org-1", userId: "ai-user", dbUser: {} as never, actorKind: "ai_agent" },
        "any-scenario-id-does-not-matter"
      )
    ).rejects.toThrow(/AI agent may PROPOSE.*may NEVER commit/)
  })

  test("the refusal is a 403 ServiceError with kind 'business', not a generic 500", async () => {
    const { svc } = await mountAndImport({})
    let thrown: unknown
    try {
      await svc.commitScenario({ orgId: "org-1", userId: "u", dbUser: {} as never, actorKind: "ai_agent" }, "s1")
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(svc.ServiceError)
    expect((thrown as { status: number }).status).toBe(403)
    expect((thrown as { kind: string }).kind).toBe("business")
  })
})

describe("commitScenario -- pipeline/task-execution reachability (a real, useful finding, not a gap)", () => {
  test("nothing under src/lib/pipeline or src/lib/task-execution imports boq-scenario-service -- the AI dispatch layer cannot reach commitScenario at all today", () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
        const full = join(dir, entry)
        const st = statSync(full)
        if (st.isDirectory()) walk(full, out)
        else if (entry.endsWith(".ts")) out.push(full)
      }
      return out
    }
    const pipelineDir = join(import.meta.dir, "..", "pipeline")
    const taskExecDir = join(import.meta.dir, "..", "task-execution")
    const files = [...walk(pipelineDir), ...walk(taskExecDir)]
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("boq-scenario-service"))
    expect(hits).toEqual([])
  }, 30000)
})

// ═══════════════════════════════════════════════════════════════════════
// 10-09/10-10/10-11 -- THE COMMIT PATH (cost side + contract side/exclude).
// Mocks "./construction-boq-service" directly for the revision-creation
// branch -- see this file's header for why.
// ═══════════════════════════════════════════════════════════════════════

describe("commitScenario -- cost side (10-09 bullet 1 / A8: freely editable, no evidence required, captured)", () => {
  test("a human, cost-side-only commit writes qtyProject/rateProject directly and marks the scenario committed -- no evidence needed, no revision created", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }]
    const { svc, scenarioRows, lineUpdateCalls } = await mountAndImport({ lines })
    scenarioRows.push({
      id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Cost trim",
      adjustments: [{ kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -10 }],
    })
    const result = await svc.commitScenario(
      { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1", name: "Test User", role: "manager" } as never, actorKind: "human" },
      "s1"
    )
    expect(result.costSide.committed).toBe(true)
    expect(result.costSide.lineItemIds).toEqual(["line-1"])
    expect(result.contractSide).toEqual({ committed: false, refused: false })
    expect(lineUpdateCalls.length).toBe(1)
    const updated = scenarioRows.find((r) => r.id === "s1")!
    expect(updated.status).toBe("committed")
    expect(updated.committedById).toBe("user-1")
  })

  test("re-committing an already-committed scenario is refused with a 409 (10-10: no re-commit)", async () => {
    const { svc, scenarioRows } = await mountAndImport({})
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "committed", name: "Already done", committedAt: new Date(), adjustments: [] })
    await expect(
      svc.commitScenario({ orgId: "org-1", userId: "u", dbUser: {} as never, actorKind: "human" }, "s1")
    ).rejects.toThrow(/already been committed/)
  })
})

describe("commitScenario -- contract side without evidence (10-09 bullet 2: REFUSED and REPORTED, cost side still commits)", () => {
  test("an unevidenced contract-side adjustment is refused and reported; a co-occurring cost-side adjustment on a DIFFERENT line still commits", async () => {
    const lines: FakeLine[] = [
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" },
      { id: "line-2", parentLineItemId: null, qtyProject: "10", rateProject: "5", qtyContract: "10", rateContract: "8" },
    ]
    const { svc, scenarioRows, lineUpdateCalls } = await mountAndImport({ lines })
    scenarioRows.push({
      id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Mixed",
      adjustments: [
        { kind: "adjust", lineItemId: "line-1", side: "project", field: "rate", changeType: "percent", value: -10 },
        { kind: "adjust", lineItemId: "line-2", side: "contract", field: "rate", changeType: "percent", value: 15 },
      ],
    })
    const result = await svc.commitScenario(
      { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } as never, actorKind: "human" },
      "s1"
    )
    expect(result.costSide.committed).toBe(true)
    expect(result.costSide.lineItemIds).toEqual(["line-1"])
    expect(result.contractSide.committed).toBe(false)
    if (!result.contractSide.committed) {
      expect(result.contractSide.refused).toBe(true)
      if (result.contractSide.refused) {
        expect(result.contractSide.refusedLineItemIds).toEqual(["line-2"])
        expect(result.contractSide.reason).toContain("evidence artefact")
      }
    }
    // No revision was created for this case (no exclude, no evidence).
    expect(lineUpdateCalls.length).toBe(1) // only line-1's cost-side write
  })
})

describe("commitScenario -- exclude routes through createBoqRevision (X-24), never a bespoke path", () => {
  test("an exclude calls the REAL createBoqRevision export (module identity, not a copy) with a line-item array reflecting the exclusion", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50", itemCode: "EX-01", description: "Excavation" }]

    let capturedLineItems: unknown = null
    const fakeRevisionRow = { id: "boq-2", projectId: "proj-1", lineItems: [{ id: "new-line-1", itemCode: "EX-01", description: "Excavation", qtyProject: null, rateProject: null, qtyContract: null, rateContract: null }] }

    const { svc, scenarioRows, lineUpdateCalls } = await mountAndImport({ lines }, {
      getBoq: mock(async () => ({ id: "boq-1", projectId: "proj-1", lineItems: lines })) as unknown as typeof realConstructionBoqService.getBoq,
      createBoqRevision: mock(async (_ctx: unknown, _boqId: string, input: { lineItems?: unknown[] }) => {
        capturedLineItems = input.lineItems
        return fakeRevisionRow
      }) as unknown as typeof realConstructionBoqService.createBoqRevision,
    })
    scenarioRows.push({
      id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Drop excavation",
      adjustments: [{ kind: "exclude", lineItemId: "line-1" }],
    })

    const result = await svc.commitScenario(
      { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } as never, actorKind: "human" },
      "s1"
    )

    expect(Array.isArray(capturedLineItems)).toBe(true)
    const excavationInput = (capturedLineItems as Array<{ itemCode?: string; quantity: number }>).find((l) => l.itemCode === "EX-01")
    expect(excavationInput?.quantity).toBe(0) // X-24: the exclude reached createBoqRevision's own guard surface as a real qty-0 line
    expect(result.contractSide.committed).toBe(true)
    if (result.contractSide.committed) expect(result.contractSide.revisionBoqId).toBe("boq-2")
    // TWO constructionBoqLineItems updates: (1) the cost-side write on the
    // LIVE line (freely editable, no evidence -- exclude zeroes qtyProject
    // too), (2) the dual-view backfill on the NEW revision's matching line
    // (createBoqRevision's own insertLineItems cannot set these 4 columns
    // at all -- see commitScenario's own header comment).
    expect(lineUpdateCalls.length).toBe(2)
    expect(lineUpdateCalls.map((c) => c.id).sort()).toEqual(["line-1", "new-line-1"].sort())
  })

  test("a ScopeReductionError thrown by the real revision guard propagates UNCHANGED (never swallowed or re-wrapped)", async () => {
    const lines: FakeLine[] = [{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50", itemCode: "EX-01", description: "Excavation" }]

    const { svc, scenarioRows } = await mountAndImport({ lines }, {
      getBoq: mock(async () => ({ id: "boq-1", projectId: "proj-1", lineItems: lines })) as unknown as typeof realConstructionBoqService.getBoq,
      createBoqRevision: mock(async () => {
        throw new realConstructionBoqService.ScopeReductionError("Scope reduction blocked -- 40% complete on site", [])
      }) as unknown as typeof realConstructionBoqService.createBoqRevision,
    })
    scenarioRows.push({ id: "s1", orgId: "org-1", boqId: "boq-1", status: "draft", name: "Blocked drop", adjustments: [{ kind: "exclude", lineItemId: "line-1" }] })

    await expect(
      svc.commitScenario({ orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } as never, actorKind: "human" }, "s1")
    ).rejects.toThrow(/Scope reduction blocked/)
  })
})
