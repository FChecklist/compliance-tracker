/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register row AW-511; spec 10.9): the PREPARED enable-writes migration and its down file (the kill switch), proven on PGlite (real
// Postgres as WASM) and by looking at the repository. The migration is NOT applied by anything: it lives in ai-os/projexa-build-002/prepared/, outside drizzle/
// and in no journal, and only the owner runs it.
//
// WHAT IS PROVEN
//   unapplied   the two files exist, are not in drizzle/ or its journal, and no other migration or file sets writes_enabled to true
//   guard       on a database that does not have the write path (0629, 0630) it REFUSES with AW500 and changes nothing (writes stay off)
//   the flip    on the full database it turns the switch on, and a level-1 link's effective level goes from 0 to 1
//   the kill    the down file turns it off again, and the effective level is 0 again; both are safe to run twice
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. enable file: drop the 0629 guard                    -> "on a database without the write path it refuses" fails
//   2. enable file: set writes_enabled = false             -> "the flip turns the switch on ..." fails
//   3. down file: set writes_enabled = true                -> "the kill switch turns it off ..." fails
//   4. drizzle/0626 (any migration) setting writes_enabled true -> "no other migration sets the switch on" fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-enable-writes.pglite.test.ts
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import type { PGlite } from "@electric-sql/pglite"
import { REPO_ROOT, createAwlDb, one } from "./__test-helpers__/awl-pglite"
import { mintLink, openWriteDb } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

const PREPARED = "ai-os/projexa-build-002/prepared/"
const ENABLE = `${PREPARED}0645_build002_awl_enable_writes.sql`
const DISABLE = `${PREPARED}0645_build002_awl_enable_writes.down.sql`
const text = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), "utf8")
const writes = async (db: PGlite) => (await one<{ w: boolean }>(db, "select writes_enabled w from platform.ai_work_link_settings")).w

describe("the prepared files are not applied by anything", () => {
  test("both files exist and are not in drizzle/ or its journal", () => {
    expect(existsSync(new URL(ENABLE, REPO_ROOT))).toBe(true)
    expect(existsSync(new URL(DISABLE, REPO_ROOT))).toBe(true)
    const files = readdirSync(new URL("drizzle/", REPO_ROOT))
    expect(files.filter((f) => /awl_enable_writes/.test(f))).toEqual([])
    expect(text("drizzle/meta/_journal.json")).not.toContain("awl_enable_writes")
    expect(existsSync(new URL("drizzle/down/", REPO_ROOT)) ? readdirSync(new URL("drizzle/down/", REPO_ROOT)).filter((f) => /awl_enable_writes/.test(f)) : []).toEqual([])
  })

  test("no other migration sets the switch on: the only statement that sets writes_enabled to true is the prepared file", () => {
    for (const dir of ["drizzle/", "drizzle/down/"]) {
      for (const f of readdirSync(new URL(dir, REPO_ROOT)).filter((n) => n.endsWith(".sql"))) {
        const sql = text(dir + f)
        expect(`${dir}${f} ${/writes_enabled\s*=\s*true/i.test(sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n"))}`).toBe(`${dir}${f} false`)
      }
    }
    expect(text(ENABLE)).toMatch(/SET writes_enabled = true/)
    expect(text(DISABLE)).toMatch(/SET writes_enabled = false/)
  })
})

describe("the flip and the kill switch", () => {
  let db: PGlite
  let bare: PGlite
  beforeAll(async () => {
    db = await openWriteDb()
    bare = await createAwlDb("0628") // no claim, no finish, no provenance columns
  }, 120_000)
  afterAll(async () => {
    await db.close()
    await bare.close()
  })

  test("on a database without the write path it refuses (AW500) and changes nothing", async () => {
    expect(await writes(bare)).toBe(false)
    let error = ""
    try {
      await bare.exec(text(ENABLE))
    } catch (e) {
      error = String((e as { message?: string }).message)
    }
    expect(error).toContain("AWL_ENABLE_REFUSED")
    // the file's own transaction is left aborted by the RAISE (a client sends ROLLBACK); the switch never changed
    await bare.exec("rollback")
    expect(await writes(bare)).toBe(false)
  })

  test("the flip turns the switch on and a level-1 link's effective level goes from 0 to 1", async () => {
    expect(await writes(db)).toBe(false)
    const link = await mintLink(db, "u-mgr", "proj-a", { level: 1 })
    const level = async () => (await one<{ r: { effective_level: number; writes_enabled: boolean } }>(db, "select public.ai_work_link__resolve($1) r", [link.token])).r
    expect(await level()).toMatchObject({ effective_level: 0, writes_enabled: false })

    await db.exec(text(ENABLE))
    expect(await writes(db)).toBe(true)
    expect(await level()).toMatchObject({ effective_level: 1, writes_enabled: true })
    // idempotent
    await db.exec(text(ENABLE))
    expect(await writes(db)).toBe(true)
  })

  test("the kill switch turns it off again, the effective level is 0 again, and it is safe to run twice", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a", { level: 1 })
    await db.exec(text(ENABLE))
    expect(await writes(db)).toBe(true)
    await db.exec(text(DISABLE))
    expect(await writes(db)).toBe(false)
    expect((await one<{ r: { effective_level: number } }>(db, "select public.ai_work_link__resolve($1) r", [link.token])).r.effective_level).toBe(0)
    await db.exec(text(DISABLE))
    expect(await writes(db)).toBe(false)
  })
})
