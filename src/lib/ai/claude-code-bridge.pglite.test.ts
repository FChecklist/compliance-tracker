/// <reference types="bun-types" />
// drizzle/0670_ai_bridge_claude_code.sql, applied for real on PGlite (in-process Postgres): the queue's behaviour, not a mock of it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test, beforeAll } from "bun:test"
import { PGlite } from "@electric-sql/pglite"

let db: PGlite
const q = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows as Record<string, unknown>[]
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0]?.r as any

beforeAll(async () => {
  db = new PGlite()
  // The roles and schema the real database already has; the migration only GRANTs to them.
  await db.exec(`create schema platform; create role anon; create role authenticated; create role app_runtime; create role service_role;`)
  await db.exec(readFileSync(join(import.meta.dir, "../../../drizzle/0670_ai_bridge_claude_code.sql"), "utf8"))
})

describe("0670 ai bridge queue", () => {
  test("with no worker seen, enqueue writes nothing and says so", async () => {
    const r = await one(`select public.ai_bridge_enqueue('p','m','sys','hello','{}'::jsonb) as r`)
    expect(r).toEqual({ worker_online: false })
    expect((await q(`select count(*)::int as n from platform.ai_bridge_request`))[0].n).toBe(0)
  })

  test("a worker's claim is its heartbeat; then enqueue queues, claim returns the oldest first, complete finishes it", async () => {
    expect(await one(`select public.ai_bridge_claim('w1') as r`)).toBeNull() // nothing queued yet, but w1 is now online
    const a = await one(`select public.ai_bridge_enqueue('p1','m','sys','first','{"jsonMode":false}'::jsonb) as r`)
    const b = await one(`select public.ai_bridge_enqueue('p2','m','sys','second','{}'::jsonb) as r`)
    expect(a.worker_online).toBe(true)
    expect((await one(`select public.ai_bridge_get('${a.id}'::uuid) as r`)).status).toBe("queued")

    const first = await one(`select public.ai_bridge_claim('w1') as r`)
    expect(first.id).toBe(a.id)
    expect(first.user).toBe("first")
    expect((await one(`select public.ai_bridge_get('${a.id}'::uuid) as r`)).status).toBe("claimed")

    // the same request cannot be claimed twice
    const second = await one(`select public.ai_bridge_claim('w2') as r`)
    expect(second.id).toBe(b.id)

    expect((await q(`select public.ai_bridge_complete('${a.id}'::uuid, '{"content":"answer"}'::jsonb, null) as r`))[0].r).toBe(true)
    const done = await one(`select public.ai_bridge_get('${a.id}'::uuid) as r`)
    expect(done).toMatchObject({ status: "done", response: { content: "answer" } })
    // completing twice is refused (the row is no longer 'claimed')
    expect((await q(`select public.ai_bridge_complete('${a.id}'::uuid, '{"content":"x"}'::jsonb, null) as r`))[0].r).toBe(false)

    await q(`select public.ai_bridge_complete('${b.id}'::uuid, null, 'boom') as r`)
    expect(await one(`select public.ai_bridge_get('${b.id}'::uuid) as r`)).toMatchObject({ status: "error", error: "boom" })
  })

  test("an unknown id answers 'missing'; an empty or oversized prompt is refused", async () => {
    expect((await one(`select public.ai_bridge_get('00000000-0000-0000-0000-000000000000'::uuid) as r`)).status).toBe("missing")
    await expect(q(`select public.ai_bridge_enqueue('p','m','s','','{}'::jsonb) as r`)).rejects.toThrow(/EMPTY_PROMPT/)
    await expect(q(`select public.ai_bridge_enqueue('p','m','s', repeat('x', 200001), '{}'::jsonb) as r`)).rejects.toThrow(/PROMPT_TOO_LARGE/)
  })

  test("stale queued rows are expired and old rows deleted by purge", async () => {
    await db.exec(`insert into platform.ai_bridge_request (user_text, created_at) values ('stale', now() - interval '5 minutes'), ('ancient', now() - interval '3 days')`)
    await q(`select public.ai_bridge_purge() as r`)
    const rows = await q(`select user_text, status from platform.ai_bridge_request where user_text in ('stale','ancient')`)
    expect(rows).toEqual([{ user_text: "stale", status: "expired" }])
  })

  test("a request older than 2 minutes is never claimed", async () => {
    await db.exec(`insert into platform.ai_bridge_request (user_text, created_at) values ('too old', now() - interval '3 minutes')`)
    await q(`select public.ai_bridge_purge() as r`) // expires it
    expect(await one(`select public.ai_bridge_claim('w1') as r`)).toBeNull()
  })

  test("the privileges: app side may enqueue/get, only the worker side may claim/complete/purge, nobody else anything", async () => {
    const can = async (role: string, fn: string) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok as boolean
    expect(await can("app_runtime", "public.ai_bridge_enqueue(text,text,text,text,jsonb)")).toBe(true)
    expect(await can("app_runtime", "public.ai_bridge_get(uuid)")).toBe(true)
    expect(await can("app_runtime", "public.ai_bridge_claim(text)")).toBe(false)
    expect(await can("app_runtime", "public.ai_bridge_complete(uuid,jsonb,text)")).toBe(false)
    expect(await can("service_role", "public.ai_bridge_claim(text)")).toBe(true)
    for (const role of ["anon", "authenticated"]) {
      for (const fn of ["public.ai_bridge_enqueue(text,text,text,text,jsonb)", "public.ai_bridge_get(uuid)", "public.ai_bridge_claim(text)", "public.ai_bridge_purge()"]) {
        expect(await can(role, fn)).toBe(false)
      }
    }
  })

  test("both tables have row-level security on and no policy", async () => {
    const rows = await q(`select relname, relrowsecurity from pg_class where relname in ('ai_bridge_request','ai_bridge_worker') order by relname`)
    expect(rows.every((r) => r.relrowsecurity === true)).toBe(true)
    expect((await q(`select count(*)::int as n from pg_policies where tablename like 'ai_bridge_%'`))[0].n).toBe(0)
  })
})
