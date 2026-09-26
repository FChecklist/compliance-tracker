/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09a (register row AW-503; spec 10.9; write-path gap report G7, G12, G13): the effective level and the availability of each function
// are recomputed from the person's LIVE role on every call, and /context, the manual, /functions and /check say the truth about them. The REAL handler
// over the REAL SQL (drizzle/0621 to 0630 on PGlite); nothing is cached between calls. Before this work a level-1 link read "level 0" with no reason,
// every function said available:false whatever the switch, and a second switch in code (executorEnabled) made the SQL flag alone change nothing.
//
// WHAT IS PROVEN
//   writes OFF        level 0 with the stored level (authority_level 1), the switch (writes_enabled false) and a plain reason; drafts are open,
//                     direct changes and function reads are not; each write function says "draft", each read function "not yet"
//   writes ON, no exec   the SQL flag alone is not enough: effective level 1, but direct_open false and the reason says the executor is not switched on
//   writes ON, exec   direct_open for a level-1 function and reads_open for a read; a level-2 function is draft only; /check says it will run directly
//   live role         the SAME token after a demotion (manager to viewer) has level 0 and no write function on its next call; a demotion to member keeps
//                     level 1 but loses the money functions; a promotion never raises the link above its ceiling or adds a function it was not made with
//   one switch        no place in the link function keeps a second, hard-coded switch
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. availabilityOf: changes_run ignores the SQL flag (exec present, writes off)       -> "with the exec function too ..." fails (reads_open true)
//   2. availabilityOf: changes_run ignores config.execPresent                           -> "without the exec function ..." fails
//   3. readContext stops returning authority_level                                      -> "writes OFF ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-effective-level.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import type { PGlite } from "@electric-sql/pglite"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import type { AwlConfig } from "../../../supabase/functions/ai-work-link/reads"
import { mintLink, openWriteDb, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
const base: AwlConfig = { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev" }
const withExec: AwlConfig = { ...base, execPresent: true }

let db: PGlite

async function get(link: J, path: string, config: AwlConfig = base, accept = "application/json"): Promise<{ status: number; json: J; text: string }> {
  const res = await handleAwl(new Request(`${F}/${link.token}${path}`, { headers: { accept } }), { config, rpc: rpcFor(db), log: () => {} })
  const text = await res.text()
  let json: J = {}
  try {
    json = JSON.parse(text)
  } catch {
    // Markdown
  }
  return { status: res.status, json, text }
}
async function post(link: J, path: string, body: unknown, config: AwlConfig = base): Promise<{ status: number; json: J }> {
  const res = await handleAwl(new Request(`${F}/${link.token}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { config, rpc: rpcFor(db), log: () => {} })
  return { status: res.status, json: (await res.json()) as J }
}
const fnOf = (ctx: J, id: string): J => (ctx.functions as J[]).find((f) => f.id === id)!
const setRole = (user: string, role: string) => db.exec(`update compliance.users set role = '${role}' where id = '${user}'`)
const WORK = { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } }

beforeAll(async () => {
  db = await openWriteDb()
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe("writes OFF: level 0 with the reason, drafts open, direct changes and reads not", () => {
  test("/context shows the effective level, the stored level, the switch and a plain reason; each function says what is open", async () => {
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    const ctx = (await get(mgr, "/context")).json

    expect(ctx).toMatchObject({ level: 0, effective_level: 0, authority_level: 1, writes_enabled: false, drafts_open: true, direct_open: false, reads_open: false, changes_available: true })
    expect(ctx.level_note).toContain("direct changes are switched off for every link")
    expect(ctx.level_note).toContain("draft")
    expect(fnOf(ctx, "record_work_progress")).toMatchObject({ kind: "write", level: 1, available: true, drafts_open: true, direct_open: false, reads_open: false })
    expect(fnOf(ctx, "add_roster_entry")).toMatchObject({ level: 2, drafts_open: true, direct_open: false })
    expect(fnOf(ctx, "get_construction_project_dashboard")).toMatchObject({ kind: "read", available: false, drafts_open: false, direct_open: false, reads_open: false })
  })

  test("the manual and the Markdown context and functions pages say the same, in words", async () => {
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    const manual = (await get(mgr, "", base, "text/markdown")).text
    expect(manual).toContain("direct changes are switched off for every link")
    expect(manual).toContain("Direct changes are not switched on")
    expect(manual).toContain("WRITES_NOT_ENABLED")
    expect(manual).toContain("`POST " + `${F}/${mgr.token}` + "/drafts`")
    expect(manual).toContain("| record_work_progress | ")
    expect(manual).toMatch(/\| record_work_progress \|[^\n]*\| draft \|/)
    expect(manual).toMatch(/\| get_construction_project_dashboard \|[^\n]*\| not yet \|/)
    const md = (await get(mgr, "/context", base, "text/markdown")).text
    expect(md).toContain("Effective level 0; the level this link was made at is 1.")
    expect(md).toContain("Direct changes are not switched on")
    const fns = (await get(mgr, "/functions", base, "text/markdown")).text
    expect(fns).toContain("Draft a change with POST /drafts")
    expect((await get(mgr, "/functions?format=json")).json.changes_available).toBe(true)
  })

  test("a link made at level 0 says so, and /actions refuses it for what is true of it: its level (not the switch)", async () => {
    const zero = await mintLink(db, "u-mgr", "proj-a2", { level: 0 })
    const ctx = (await get(zero, "/context")).json
    expect(ctx).toMatchObject({ level: 0, authority_level: 0, writes_enabled: false })
    expect(ctx.level_note).toContain("made at level 0")
    const r = await post(zero, "/actions", WORK)
    expect(r.status).toBe(403)
    expect(r.json.code).toBe("LEVEL_NOT_ALLOWED")
    // a level-1 link refused while the switch is off is refused for the switch
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    const off = await post(mgr, "/actions", WORK)
    expect(off.status).toBe(403)
    expect(off.json.code).toBe("WRITES_NOT_ENABLED")
    expect(off.json.hint).toContain("/drafts")
  })

  test("a viewer's link has no change function to draft or run: the effective list is what SQL computes now", async () => {
    const viewer = await mintLink(db, "u-view", "proj-a", { level: 0 })
    const ctx = (await get(viewer, "/context")).json
    expect((ctx.functions as J[]).filter((f) => f.kind === "write")).toEqual([])
    expect(ctx.level_note).toContain("level 0")
    expect((await post(viewer, "/drafts", { function: "create_meeting", params: { title: "x", scheduledAt: "2026-10-01T10:00:00Z" } })).status).toBe(403)
  })
})

describe("writes ON: the SQL flag alone is not the whole switch", () => {
  test("without the exec function: effective level 1 but nothing runs directly, and the reason says the executor is not switched on", async () => {
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    await setWrites(db, true)
    try {
      const ctx = (await get(mgr, "/context")).json
      expect(ctx).toMatchObject({ level: 1, effective_level: 1, authority_level: 1, writes_enabled: true, direct_open: false, reads_open: false, drafts_open: true })
      expect(ctx.level_note).toContain("executor is not switched on yet")
      expect(fnOf(ctx, "record_work_progress")).toMatchObject({ drafts_open: true, direct_open: false })
      const check = (await post(mgr, "/check", WORK)).json
      expect(check).toMatchObject({ valid: true, will_execute_directly: false, available: true })
      expect(check.note).toContain("POST /drafts")
      const act = await post(mgr, "/actions", WORK)
      expect(act.status).toBe(503)
      expect(act.json).toMatchObject({ code: "EXECUTOR_NOT_AVAILABLE", available: false })
    } finally {
      await setWrites(db, false)
    }
  })

  test("with the exec function too: a level-1 function is direct, a read function is open, a level-2 function is draft only", async () => {
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    await setWrites(db, true)
    try {
      const ctx = (await get(mgr, "/context", withExec)).json
      expect(ctx).toMatchObject({ level: 1, direct_open: true, reads_open: true, drafts_open: true, writes_enabled: true })
      expect(ctx.level_note).toBe("Direct level-1 changes are on for this link.")
      expect(fnOf(ctx, "record_work_progress")).toMatchObject({ available: true, drafts_open: true, direct_open: true })
      expect(fnOf(ctx, "add_roster_entry")).toMatchObject({ available: true, drafts_open: true, direct_open: false })
      expect(fnOf(ctx, "get_construction_project_dashboard")).toMatchObject({ available: true, reads_open: true })
      expect((await post(mgr, "/check", WORK, withExec)).json.will_execute_directly).toBe(true)
      const manual = (await get(mgr, "", withExec, "text/markdown")).text
      expect(manual).toMatch(/\| record_work_progress \|[^\n]*\| draft or direct \|/)
      expect(manual).toContain("Direct level-1 changes are switched on for this link")
      // and the same link with the switch flipped back is level 0 again on the very next call
      await setWrites(db, false)
      expect((await get(mgr, "/context", withExec)).json).toMatchObject({ level: 0, direct_open: false, reads_open: false, writes_enabled: false })
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("the live role is read on every call: a demotion at once, a promotion never above the ceiling", () => {
  test("the SAME token after a demotion: manager to viewer is level 0 with no write function; manager to member keeps level 1 but loses the money functions", async () => {
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    await setWrites(db, true)
    try {
      const before = (await get(mgr, "/context", withExec)).json
      expect(before.level).toBe(1)
      expect(before.allowed_functions).toContain("get_construction_budget_status")

      await setRole("u-mgr", "member")
      const asMember = (await get(mgr, "/context", withExec)).json
      expect(asMember.level).toBe(1)
      expect(asMember.allowed_functions).not.toContain("get_construction_budget_status")
      expect(asMember.acting_for.money_visible).toBe(false)

      await setRole("u-mgr", "viewer")
      const asViewer = (await get(mgr, "/context", withExec)).json
      expect(asViewer).toMatchObject({ level: 0, effective_level: 0, authority_level: 1, direct_open: false })
      expect((asViewer.functions as J[]).filter((f) => f.kind === "write")).toEqual([])
      expect(asViewer.level_note).toContain("role can no longer make changes")
      expect((await post(mgr, "/actions", WORK, withExec)).json.code).toBe("FUNCTION_NOT_ON_LINK")
      expect((await post(mgr, "/drafts", { function: "create_meeting", params: { title: "x", scheduledAt: "2026-10-01T10:00:00Z" } }, withExec)).json.code).toBe("FUNCTION_NOT_ON_LINK")
      const manual = (await get(mgr, "", withExec, "text/markdown")).text
      expect(manual).not.toContain("| record_work_progress |")

      await setRole("u-mgr", "manager")
      expect((await get(mgr, "/context", withExec)).json.level).toBe(1)
    } finally {
      await setRole("u-mgr", "manager")
      await setWrites(db, false)
    }
  })

  test("a promotion never raises the link above the level it was made at, and never adds a function it was not made with", async () => {
    const zero = await mintLink(db, "u-mem", "proj-a", { level: 0 })
    const member = await mintLink(db, "u-mem", "proj-a2")
    await setWrites(db, true)
    try {
      await setRole("u-mem", "manager")
      const ctx = (await get(zero, "/context", withExec)).json
      expect(ctx).toMatchObject({ level: 0, authority_level: 0 })
      const m = (await get(member, "/context", withExec)).json
      expect(m.level).toBe(1)
      // the member's link was made without the two money functions: a promotion to manager does not add them
      expect(m.allowed_functions).not.toContain("get_construction_budget_status")
      expect(m.acting_for.money_visible).toBe(true)
    } finally {
      await setRole("u-mem", "member")
      await setWrites(db, false)
    }
  })
})

describe("one switch", () => {
  test("no executorEnabled is left anywhere in the link function, and config.ts names execPresent as a constant", () => {
    const dir = new URL("../../../supabase/functions/ai-work-link/", import.meta.url)
    for (const f of ["config.ts", "handler.ts", "reads.ts", "drafts.ts", "manual.ts", "render.ts", "mcp.ts", "confirm.ts", "index.ts"]) {
      expect(`${f} ${readFileSync(new URL(f, dir), "utf8").includes("executorEnabled")}`).toBe(`${f} false`)
    }
    expect(readFileSync(new URL("config.ts", dir), "utf8")).toContain("export const EXEC_FUNCTION_PRESENT = false")
  })
})
