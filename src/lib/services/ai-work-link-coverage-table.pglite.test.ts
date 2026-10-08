/// <reference types="bun-types" />
// P5 (AI function coverage, 2026-10-08): a freshly minted level-1 link carries EVERY function that ai-os/audit37/AI_FUNCTION_COVERAGE_2026-10-08.md
// marks `covered` or `built` (the table of what a person's PROJEXA work the AI can do, area by area, from Sumeet's 111 requirements).
// On PGlite (real Postgres as WASM) over 0621 to 0669, the sync's 0677 to 0683, 0685, 0687, 0693 and the current seed 0738, as the live database
// will have them. No live database is touched.
//   * the table's own counts agree with its rows, and every function it names exists in the generated registry and is on links (a level, not null);
//   * an admin's project link minted at level 1 (writes on) resolves to a function list that holds every covered/built function of the table;
//   * a member's level-1 link holds every covered/built function whose minimum rank is the member's (rank 2);
//   * create_project (on a person-wide link only, by 0668's rule) is on a fresh person-wide link.
// If a function the table calls covered is dropped from the seed, from the registry, or from what a fresh link gets, this file fails and names it.
// Run: bun test --isolate src/lib/services/ai-work-link-coverage-table.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { forwardSql, read } from "./__test-helpers__/awl-pglite"
import { call, createUserLinkDb, mintProject, mintUser, setWrites, type J } from "./__test-helpers__/awl-user-link-db"

setDefaultTimeout(240_000)

const TABLE = "ai-os/audit37/AI_FUNCTION_COVERAGE_2026-10-08.md"
type FnRow = { function_id: string; link_level: number | null; min_role_rank: number }
const REGISTRY = JSON.parse(read("supabase/functions/ai-work-link/function-registry.generated.json")) as FnRow[]

type TableRow = { area: string; action: string; functions: string[]; status: string }

/** The rows of the coverage table: `| # | Area | Action | Function | Status |`. Function ids are the backticked names in the Function column. */
export function coverageRows(markdown: string): TableRow[] {
  const rows: TableRow[] = []
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim())
    // a data row has 5 cells between its outer pipes and a numeric area number
    if (cells.length !== 7 || !/^\d+$/.test(cells[1])) continue
    rows.push({ area: cells[2], action: cells[3], functions: [...cells[4].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]), status: cells[5] })
  }
  return rows
}

const rows = coverageRows(read(TABLE))
const covered = [...new Set(rows.filter((r) => r.status === "covered" || r.status === "built").flatMap((r) => r.functions))].sort()
// create_project is on a person-wide (user) link only, never on a project link (0668's rule): it is checked on a fresh user link instead
const USER_LINK_ONLY = ["create_project"]
const onProjectLink = covered.filter((fn) => !USER_LINK_ONLY.includes(fn))

let db: PGlite
let adm: J
let mem: J
let usr: J

beforeAll(async () => {
  db = await createUserLinkDb()
  for (const m of [
    "0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0683_projexa_sync_more_kinds",
    "0685_awl_ai_crud", "0687_awl_ai_crud_b5", "0693_awl_full_rights", "0738_awl_update_drawing",
  ]) {
    await db.exec(forwardSql(m))
  }
  await setWrites(db, true)
  adm = await mintProject(db, "u-adm", "proj-a", { level: 1 })
  mem = await mintProject(db, "u-mem", "proj-a", { level: 1 })
  usr = await mintUser(db, "u-mem")
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the coverage table itself", () => {
  test("every row has a known status; the counts section agrees with the rows", () => {
    const statuses = ["covered", "built", "record", "person", "missing"]
    for (const r of rows) expect({ action: r.action, status: r.status, known: statuses.includes(r.status) }).toEqual({ action: r.action, status: r.status, known: true })
    const counts = Object.fromEntries(statuses.map((s) => [s, rows.filter((r) => r.status === s).length]))
    const md = read(TABLE)
    for (const s of statuses) expect(md).toContain(`| ${s} | ${counts[s]} |`)
    expect(md).toContain(`| **total** | **${rows.length}** |`)
    expect(md).toContain(`Distinct function ids named in \`covered\` and \`built\` rows: ${covered.length} of`)
  })

  test("a covered or built row names at least one function; a missing or person row names none", () => {
    for (const r of rows.filter((x) => x.status !== "record")) {
      const names = r.status === "covered" || r.status === "built"
      expect({ action: r.action, has: r.functions.length > 0 }).toEqual({ action: r.action, has: names })
    }
  })

  test("every function the table names exists in the generated registry and is on links", () => {
    const onLinks = new Set(REGISTRY.filter((f) => f.link_level !== null).map((f) => f.function_id))
    expect(covered.filter((fn) => !onLinks.has(fn))).toEqual([])
  })
})

describe("a freshly minted level-1 link carries every covered function", () => {
  test("an admin's link: no covered or built function is missing", async () => {
    const ctx = await call(db, "ai_work_link__resolve", [adm.token])
    expect(ctx.effective_level).toBe(1)
    const fns = new Set(ctx.effective_functions as string[])
    expect(onProjectLink.filter((fn) => !fns.has(fn))).toEqual([])
  })

  test("a member's link: every covered function at the member's rank is there", async () => {
    const ctx = await call(db, "ai_work_link__resolve", [mem.token])
    const fns = new Set(ctx.effective_functions as string[])
    const memberRank = onProjectLink.filter((fn) => REGISTRY.find((f) => f.function_id === fn)!.min_role_rank <= 2)
    expect(memberRank).toContain("update_drawing")
    expect(memberRank.filter((fn) => !fns.has(fn))).toEqual([])
  })

  test("a member's person-wide link (minted at the highest level the role allows, 0693) carries create_project", async () => {
    expect(usr.level).toBe(1)
    const ctx = await call(db, "ai_work_link__resolve", [usr.token])
    expect(USER_LINK_ONLY.filter((fn) => !(ctx.effective_functions as string[]).includes(fn))).toEqual([])
  })
})
