/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46 step 1 (BR-581; spec AWL-S03 and AWL-S05): the Universal AI Work Link's function registry is generated from
// src/lib/pipeline/function-registry.ts, is up to date, has exactly 10 functions on links, and none of the excluded ones.
//
// WHERE THIS FILE LIVES. The register row runs `bun test --isolate scripts/gen-ai-link-registry.test.ts`. bunfig.toml sets the test
// root to src/, and bun reads a filter that is not written as ./path as a substring of the paths under that root, so a test at
// scripts/ would match nothing ("did not match any test files") and CI would never run it either. This file sits at
// src/scripts/gen-ai-link-registry.test.ts, whose path contains the row's filter, so the command as written finds it and CI runs it.
// scripts/gen-ai-link-registry.test.ts re-exports it for anyone who runs the file by its path.
//
// WHAT IS PROVEN
//   - the three committed outputs equal what the registry generates today (the check that CI and the register row rely on), and the
//     CLI's --check says so;
//   - exactly the spec's 10 functions (section 9.1) are on links, at the spec's levels and ranks, and each of the 17 the spec excludes
//     is generated as excluded with a reason (independent copy of the spec's table below, so a typo in the data file is caught);
//   - it survives what another unit does to function-registry.ts: 26 entries added later (U-38) have no row, are on no link and leave the
//     committed outputs current, the 10 do not move; a removed or renamed allow-listed function is an error, never a silent drop; a
//     wrong kind or an undeclared text parameter is an error;
//   - the generated text parameters are declared by the registry, and the id parameters are the four of spec section 9.10;
//   - the seed block: it changes only when a database-side fact changes, the file is patched between its markers and nowhere else,
//     and a stale JSON file, a stale seed block or a missing file is reported by name.
import { describe, test, expect } from "bun:test"
import { fileURLToPath } from "node:url"
import { ALL_FUNCTION_SPECS, type FunctionSpec } from "@/lib/pipeline/function-registry"
import {
  BEGIN_MARK, CURRENT_SEED_MIGRATION, END_MARK, FUNCTIONS_JSON, KINDS_JSON, buildFunctionRows, buildKindRows, expectedOutputs, extractBlock,
  fsIo, main, registryVersion, renderSeedBlock, spliceBlock, staleOutputs, unreviewedFunctionIds, type Io,
} from "../../scripts/gen-ai-link-registry"
import { EXCLUDED_REASONS, LINK_FUNCTIONS, RECORD_KINDS } from "../../scripts/gen-ai-link-registry.data"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))

// spec 9.1, written out again here on purpose: function -> [function link level, minimum role rank]
const SPEC_ON_LINKS: Record<string, [number, number]> = {
  get_construction_project_dashboard: [0, 1],
  get_construction_budget_status: [0, 3],
  get_construction_kpi_status: [0, 3],
  record_work_progress: [1, 2],
  record_attendance: [1, 2],
  record_timesheet: [1, 2],
  create_meeting: [1, 2],
  create_document: [1, 2],
  add_roster_entry: [2, 2],
  create_boq_revision: [2, 2],
}
// spec 9.1: the 17 excluded (the register row AWL-S03 names the first five)
const SPEC_EXCLUDED = [
  "review_budget", "generate_construction_progress_summary", "detect_construction_budget_schedule_risk", "list_delayed_activities",
  "list_over_budget_projects", "get_compliance_stats", "get_overdue_items", "list_departments", "list_compliance_items", "list_notices",
  "list_gst_import_batches", "list_gst_returns", "list_customers", "list_sales_orders", "list_leads", "list_opportunities",
  "get_sales_pipeline_overview",
]
const AWL_S03_BAD = ["generate_construction_progress_summary", "detect_construction_budget_schedule_risk", "list_delayed_activities", "list_over_budget_projects", "review_budget"]

const memIo = (files: Record<string, string>): Io & { files: Record<string, string> } => ({
  root: "/mem",
  files,
  exists: (rel) => rel in files,
  read: (rel) => {
    if (!(rel in files)) throw new Error(`no such file ${rel}`)
    return files[rel]
  },
  write: (rel, text) => {
    files[rel] = text
  },
  log: () => {},
})

const fakeSpec = (functionId: string, kind: FunctionSpec["kind"], extra: Partial<FunctionSpec> = {}): FunctionSpec => ({
  functionId, label: `Label of ${functionId}`, module: "test", kind, writes: kind === "write", requiresProject: true, requiredParams: [], ...extra,
})

describe("the committed outputs are current", () => {
  test("staleOutputs is empty and the CLI's --check says the registry is up to date", () => {
    const io = fsIo(ROOT)
    expect(staleOutputs(io)).toEqual([])
    const lines: string[] = []
    expect(main(["--check"], { ...io, log: (l) => lines.push(l) })).toBe(0)
    expect(lines).toEqual(["ai-link registry up to date"])
  })

  test("the seed migration and both JSON files exist where the spec and the register say", () => {
    const io = fsIo(ROOT)
    for (const f of [FUNCTIONS_JSON, KINDS_JSON, CURRENT_SEED_MIGRATION]) expect(io.exists(f)).toBe(true)
    expect(FUNCTIONS_JSON).toBe("supabase/functions/ai-work-link/function-registry.generated.json")
    expect(CURRENT_SEED_MIGRATION).toBe("drizzle/0628_build001_awl_seed.sql")
  })

  test("AWL-S03's own reading: a JSON list whose entries with a non-null link_level are the 10, and none of the five bad ones", () => {
    const list = JSON.parse(fsIo(ROOT).read(FUNCTIONS_JSON)) as { function_id: string; link_level: number | null }[]
    expect(Array.isArray(list)).toBe(true)
    const on = new Set(list.filter((f) => f.link_level !== null).map((f) => f.function_id))
    expect(on.size).toBe(10)
    for (const bad of AWL_S03_BAD) expect(on.has(bad)).toBe(false)
  })
})

describe("exactly the spec's 10 functions are on links", () => {
  const rows = buildFunctionRows(ALL_FUNCTION_SPECS)
  const on = rows.filter((r) => r.link_level !== null)

  test("the 10 are the spec's, at the spec's levels and minimum ranks", () => {
    expect(on.length).toBe(10)
    expect(on.map((r) => r.function_id).sort()).toEqual(Object.keys(SPEC_ON_LINKS).sort())
    for (const r of on) {
      expect({ id: r.function_id, level: r.link_level as number | null, rank: r.min_role_rank }).toEqual({ id: r.function_id, level: SPEC_ON_LINKS[r.function_id][0], rank: SPEC_ON_LINKS[r.function_id][1] })
      expect(r.excluded_reason).toBeNull()
    }
    // a read is level 0; the writes are 1 or 2; the two that touch a daily rate or a commercial baseline are drafts only
    expect(on.filter((r) => r.kind === "read").every((r) => r.link_level === 0)).toBe(true)
    expect(on.filter((r) => r.kind === "write").every((r) => r.link_level === 1 || r.link_level === 2)).toBe(true)
    expect(on.filter((r) => r.link_level === 2).map((r) => r.function_id).sort()).toEqual(["add_roster_entry", "create_boq_revision"])
  })

  test("each of the 17 the spec excludes is present, on no link, with a reason", () => {
    expect(SPEC_EXCLUDED.length).toBe(17)
    for (const id of SPEC_EXCLUDED) {
      const r = rows.find((x) => x.function_id === id)
      expect({ id, found: !!r }).toEqual({ id, found: true })
      expect({ id, level: r!.link_level, reason: !!r!.excluded_reason }).toEqual({ id, level: null, reason: true })
    }
  })

  test("the output holds the 27 reviewed functions once each: the 10 on links and the 17 excluded; everything else is on no link", () => {
    expect(rows.length).toBe(27)
    expect(new Set(rows.map((r) => r.function_id)).size).toBe(rows.length)
    expect(rows.map((r) => r.function_id).sort()).toEqual([...Object.keys(SPEC_ON_LINKS), ...SPEC_EXCLUDED].sort())
    expect(rows.find((r) => r.function_id === "run_work_progress_report")).toBeUndefined()
    // a registry function that has an executor and that nobody reviewed has no row: it is listed as unreviewed, never as on a link
    const executable = ALL_FUNCTION_SPECS.filter((s) => s.kind !== "run")
    const unreviewed = unreviewedFunctionIds(ALL_FUNCTION_SPECS)
    expect(rows.length + unreviewed.length).toBe(executable.length)
    for (const id of unreviewed) expect({ id, inOutput: rows.some((r) => r.function_id === id) }).toEqual({ id, inOutput: false })
  })

  test("no function is both allow-listed and excluded in the data file, and every excluded one has a real reason", () => {
    for (const id of Object.keys(LINK_FUNCTIONS)) expect(id in EXCLUDED_REASONS).toBe(false)
    for (const [id, reason] of Object.entries(EXCLUDED_REASONS)) expect({ id, ok: reason.length > 20 }).toEqual({ id, ok: true })
    expect(Object.keys(EXCLUDED_REASONS).sort()).toEqual([...SPEC_EXCLUDED].sort())
  })

  test("the free-text parameters are declared by the registry, and the id parameters are the four of spec 9.10", () => {
    for (const r of on) for (const t of r.text_params) expect({ id: r.function_id, t, declared: r.declared_params.includes(t) }).toEqual({ id: r.function_id, t, declared: true })
    const idParams = new Set(on.flatMap((r) => r.id_params))
    expect([...idParams].sort()).toEqual(["boqId", "boqLineItemId", "issueId", "rosterId"])
    expect(on.find((r) => r.function_id === "record_work_progress")!.id_params).toEqual(["boqLineItemId"])
    expect(on.find((r) => r.function_id === "record_work_progress")!.required_params.map((p) => p.name)).toEqual(["projectId", "itemCode", "percent"])
    expect(on.find((r) => r.function_id === "record_work_progress")!.required_params[1].any_of).toEqual(["itemCode", "boqLineItemId"])
  })

  test("rows are sorted by id, and money-sensitive functions are the reads of dashboard, budget and KPIs plus the two draft-only writes", () => {
    expect(rows.map((r) => r.function_id)).toEqual([...rows.map((r) => r.function_id)].sort())
    expect(on.filter((r) => r.money_sensitive).map((r) => r.function_id).sort()).toEqual([
      "add_roster_entry", "create_boq_revision", "get_construction_budget_status", "get_construction_kpi_status", "get_construction_project_dashboard",
    ])
  })
})

describe("it survives what other units do to function-registry.ts", () => {
  const real = [...ALL_FUNCTION_SPECS]

  test("entries added later (a read, a write, a command) are on no link, have no row, and change nothing the generator writes", () => {
    const grown = [...real, fakeSpec("zz_new_read", "ask"), fakeSpec("zz_new_write", "write"), fakeSpec("zz_new_run", "run", { writes: false })]
    expect(buildFunctionRows(grown)).toEqual(buildFunctionRows(real))
    expect(buildFunctionRows(grown).filter((r) => r.link_level !== null).length).toBe(10)
    expect(unreviewedFunctionIds(grown)).toEqual([...unreviewedFunctionIds(real), "zz_new_read", "zz_new_write"].sort())
  })

  test("the merge of another unit's registry entries (26 of them, U-38) leaves the committed outputs current; --unreviewed names them", () => {
    const added = Array.from({ length: 26 }, (_, i) => fakeSpec(`zz_unit38_${i}`, i % 3 === 0 ? "write" : "ask"))
    const grown = [...real, ...added]
    expect(staleOutputs(fsIo(ROOT), grown)).toEqual([])
    const lines: string[] = []
    const io = { ...fsIo(ROOT), log: (l: string) => lines.push(l) }
    expect(main(["--check"], io, grown)).toBe(0)
    expect(lines).toEqual(["ai-link registry up to date"])
    lines.length = 0
    expect(main(["--unreviewed"], io, grown)).toBe(0)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain(`${unreviewedFunctionIds(real).length + 26} registry function(s) are not reviewed for links`)
    for (const a of added) expect(lines[0]).toContain(a.functionId)
  })

  test("a changed label or a reordered registry does not change what the database is seeded with", () => {
    const relabelled = real.map((s) => (s.functionId === "record_work_progress" ? { ...s, label: "A different label" } : s)).reverse()
    const a = buildFunctionRows(real)
    const b = buildFunctionRows(relabelled)
    expect(registryVersion(a, buildKindRows())).toBe(registryVersion(b, buildKindRows()))
    expect(b.find((r) => r.function_id === "record_work_progress")!.label).toBe("A different label") // the JSON does follow it
    expect(a).not.toEqual(b)
  })

  test("an allow-listed function that the registry no longer has is an error naming it, not a silent drop", () => {
    for (const id of Object.keys(LINK_FUNCTIONS)) {
      expect(() => buildFunctionRows(real.filter((s) => s.functionId !== id))).toThrow(`allow-listed function "${id}" is not in function-registry.ts`)
    }
    // renamed = removed under the old name
    const renamed = real.map((s) => (s.functionId === "create_meeting" ? { ...s, functionId: "create_meeting_v2" } : s))
    expect(() => buildFunctionRows(renamed)).toThrow('"create_meeting"')
  })

  test("a function whose registry kind disagrees with its level, or that names an undeclared text parameter, is an error", () => {
    const asRead = real.map((s) => (s.functionId === "record_attendance" ? { ...s, kind: "ask" as const, writes: false } : s))
    expect(() => buildFunctionRows(asRead)).toThrow(/record_attendance.*level 1.*read/)
    const asWrite = real.map((s) => (s.functionId === "get_construction_kpi_status" ? { ...s, kind: "write" as const, writes: true } : s))
    expect(() => buildFunctionRows(asWrite)).toThrow(/get_construction_kpi_status.*level 0.*writes/)
    expect(() => buildFunctionRows(real, { ...LINK_FUNCTIONS, create_meeting: { ...LINK_FUNCTIONS.create_meeting, textParams: ["not_a_param"] } })).toThrow('text parameter "not_a_param"')
    expect(() => buildFunctionRows(real, { ...LINK_FUNCTIONS, create_meeting: { ...LINK_FUNCTIONS.create_meeting, minRank: 9 } })).toThrow("invalid minimum rank")
    expect(() => buildFunctionRows(real, LINK_FUNCTIONS, { ...EXCLUDED_REASONS, create_meeting: "x" })).toThrow("both allow-listed and excluded")
  })

  test("the allow-list is the only way on: putting an excluded function in it puts it on links, taking one out puts it off", () => {
    const withAlias = buildFunctionRows(real, { ...LINK_FUNCTIONS, review_budget: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] } }, Object.fromEntries(Object.entries(EXCLUDED_REASONS).filter(([k]) => k !== "review_budget")))
    expect(withAlias.filter((r) => r.link_level !== null).length).toBe(11)
    const { record_attendance: _gone, ...fewer } = LINK_FUNCTIONS
    expect(buildFunctionRows(real, fewer).filter((r) => r.link_level !== null).length).toBe(9)
  })
})

describe("the record kinds", () => {
  const kinds = buildKindRows()

  test("there are the 13 kinds of spec section 6.2, and the spec's money columns are marked", () => {
    expect(kinds.map((k) => k.kind)).toEqual(["project", "boqs", "boq_lines", "activities", "progress", "tasks", "meetings", "documents", "roster", "attendance", "timesheets", "pipeline_tasks", "people"])
    const money = Object.fromEntries(kinds.map((k) => [k.kind, k.money_columns]))
    expect(money.project).toEqual(["project_value", "vat_rate_percent", "retention_percent"])
    expect(money.boqs).toEqual(["contract_value_override"])
    expect(money.boq_lines).toEqual(expect.arrayContaining(["rate", "amount", "material_cost", "labour_cost", "equipment_cost", "budget_percentage", "vendor_amount", "material_amount", "manpower_amount", "rate_project"]))
    expect(money.roster).toEqual(["daily_rate"])
    expect(money.attendance).toEqual(["daily_cost"])
    expect(money.timesheets).toEqual(["hourly_rate_snapshot", "invoice_item_id"])
    expect(money.pipeline_tasks).toEqual(["params", "result"])
    expect(kinds.find((k) => k.kind === "pipeline_tasks")!.filters.omit_when_hidden).toEqual(["params", "result"])
    for (const k of ["activities", "progress", "tasks", "meetings", "documents", "people"]) expect(money[k]).toEqual([])
  })

  test("a duplicate kind, or an omit_when_hidden column that is not a money column, is an error", () => {
    expect(() => buildKindRows([RECORD_KINDS[0], RECORD_KINDS[0]])).toThrow("defined twice")
    expect(() => buildKindRows([{ kind: "x", moneyColumns: ["a"], fields: {}, sort: [], omitWhenHidden: ["b"] }])).toThrow("not a money column")
    expect(() => buildKindRows([{ kind: "x", moneyColumns: [], fields: {}, sort: [""] }])).toThrow("empty sort field")
  })
})

describe("the seed block and the two JSON files", () => {
  const want = expectedOutputs(ALL_FUNCTION_SPECS)
  const template = `-- header written by hand\nBEGIN;\n${BEGIN_MARK}\n-- old\n${END_MARK}\nCOMMIT;\n`

  test("a generated file holds exactly what the registry says, and the block sits between its markers", () => {
    expect(want.seedBlock.startsWith(BEGIN_MARK)).toBe(true)
    expect(want.seedBlock.endsWith(END_MARK)).toBe(true)
    expect(want.seedBlock).toContain(`registry version ${registryVersion(want.functions, want.kinds)}`)
    expect(want.seedBlock).toContain(`RETURNS text`)
    expect((want.seedBlock.match(/^  \('/gm) ?? []).length).toBe(want.functions.length + want.kinds.length)
    expect(want.functionsJson.endsWith("\n")).toBe(true)
    expect(JSON.parse(want.functionsJson).length).toBe(want.functions.length)
  })

  test("main() writes the two JSON files and patches only the block of the seed migration, then --check passes", () => {
    const io = memIo({ [CURRENT_SEED_MIGRATION]: template })
    expect(main([], io)).toBe(0)
    expect(io.files[FUNCTIONS_JSON]).toBe(want.functionsJson)
    expect(io.files[KINDS_JSON]).toBe(want.kindsJson)
    const seed = io.files[CURRENT_SEED_MIGRATION]
    expect(seed.startsWith("-- header written by hand\nBEGIN;\n")).toBe(true)
    expect(seed.endsWith("\nCOMMIT;\n")).toBe(true)
    expect(extractBlock(seed)).toBe(want.seedBlock)
    expect(staleOutputs(io)).toEqual([])
    expect(main(["--check"], io)).toBe(0)
    // writing again changes nothing
    const before = { ...io.files }
    expect(main([], io)).toBe(0)
    expect(io.files).toEqual(before)
  })

  test("--check names each stale or missing output, and exits 1", () => {
    const fresh = memIo({ [CURRENT_SEED_MIGRATION]: template })
    main([], fresh)
    const stale = (mutate: (f: Record<string, string>) => void) => {
      const io = memIo({ ...fresh.files })
      mutate(io.files)
      const lines: string[] = []
      const code = main(["--check"], { ...io, log: (l) => lines.push(l) })
      return { code, lines, stale: staleOutputs(io) }
    }
    const a = stale((f) => { f[FUNCTIONS_JSON] = f[FUNCTIONS_JSON].replace('"link_level": 1', '"link_level": 2') })
    expect(a).toMatchObject({ code: 1, stale: [FUNCTIONS_JSON] })
    expect(a.lines).toEqual([`ai-link registry is stale: ${FUNCTIONS_JSON} (run: bun scripts/gen-ai-link-registry.ts)`])
    expect(stale((f) => { f[KINDS_JSON] = "[]\n" }).stale).toEqual([KINDS_JSON])
    expect(stale((f) => { f[CURRENT_SEED_MIGRATION] = f[CURRENT_SEED_MIGRATION].replace("'record_attendance', 'projexa', 'write', 1", "'record_attendance', 'projexa', 'write', 2") }).stale).toEqual([CURRENT_SEED_MIGRATION])
    expect(stale((f) => { delete f[FUNCTIONS_JSON] }).stale).toEqual([FUNCTIONS_JSON])
    expect(stale((f) => { delete f[CURRENT_SEED_MIGRATION] }).stale).toEqual([CURRENT_SEED_MIGRATION])
    expect(stale((f) => { f[CURRENT_SEED_MIGRATION] = "no markers here" }).stale).toEqual([CURRENT_SEED_MIGRATION])
    expect(stale((f) => { f[FUNCTIONS_JSON] = f[FUNCTIONS_JSON].replace(/\n$/, "") }).stale).toEqual([FUNCTIONS_JSON])
  })

  test("a change to a reviewed registry entry makes the committed files stale, an unreviewed entry does not", () => {
    const io = memIo({ [CURRENT_SEED_MIGRATION]: template })
    main([], io)
    // a change to what an allow-listed function declares shows in the JSON (its parameters), not in the seed (a database-side fact)
    const changed = ALL_FUNCTION_SPECS.map((s) => (s.functionId === "create_meeting" ? { ...s, requiredParams: [...s.requiredParams, { name: "note", label: "Note", code: "TITLE_REQUIRED" as const }] } : s))
    expect(staleOutputs(io, changed)).toEqual([FUNCTIONS_JSON])
    // a reviewed exclusion that the registry drops is a change of the outputs: its row goes, so the JSON and the seed block are stale
    const dropped = ALL_FUNCTION_SPECS.filter((s) => s.functionId !== "list_leads")
    expect(staleOutputs(io, dropped)).toEqual([FUNCTIONS_JSON, CURRENT_SEED_MIGRATION])
    expect(main(["--check"], io, dropped)).toBe(1)
    // an entry that nobody reviewed changes nothing
    const grown = [...ALL_FUNCTION_SPECS, fakeSpec("zz_added_by_another_unit", "ask")]
    expect(staleOutputs(io, grown)).toEqual([])
    expect(main(["--check"], io, grown)).toBe(0)
  })

  test("splicing refuses a file with no marker pair, and writing with no seed file says so instead of guessing", () => {
    expect(() => spliceBlock("nothing", want.seedBlock)).toThrow("no complete BEGIN/END GENERATED marker pair")
    const io = memIo({})
    expect(main([], io)).toBe(2)
    expect(main(["--bogus"], io)).toBe(2)
    expect(main(["--check", "--unreviewed"], io)).toBe(2)
  })

  test("the registry version is a sha256, and it changes with a database-side fact and with nothing else", () => {
    const v = registryVersion(want.functions, want.kinds)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    const bumped = want.functions.map((f) => (f.function_id === "record_attendance" ? { ...f, min_role_rank: 3 } : f))
    expect(registryVersion(bumped, want.kinds)).not.toBe(v)
    const labelled = want.functions.map((f) => ({ ...f, label: `${f.label}!`, declared_params: [...f.declared_params, "zz"] }))
    expect(registryVersion(labelled, want.kinds)).toBe(v)
    expect(renderSeedBlock(want.functions, want.kinds)).toBe(want.seedBlock)
  })
})
