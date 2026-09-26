/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09a (register row AW-507; spec 9.3): the write caps (30 an hour, 200 a day, counted from intent rows) and the idempotent replay of
// the Universal AI Work Link, proved through the REAL SQL (drizzle/0629 and the functions of 0626 on PGlite) and through the REAL handler for POST /actions
// with a stand-in for the exec function (which finishes each intent through ai_work_link_intent_finish, as the exec host will). Writes are switched on for
// the tests that need them and back off after. No live database, no network, no business row is written by anything here.
//
// WHAT IS PROVEN
//   caps       the 31st intent in an hour is refused WRITE_CAP_HOUR and the 201st in a day WRITE_CAP_DAY; drafts and actions share the count; a
//              failed intent still counts (a slot spent); rows older than an hour do not count towards the hour; a replay at the cap is answered,
//              not refused; a refusal writes nothing
//   replay     the same key is the same intent (id, no second row, no second slot, no confirm code again); with no key the same function and
//              parameters on the same UTC day are one intent whatever the key order, different parameters are another; done keeps its key and a
//              replay returns its stored outcome; failed, refused and expired free the key
//   /actions   through the handler: record, claim, then the exec function ONCE; the answer is 201 with the record; the same request again is 200
//              replayed with the stored record and the exec function is not called again; a failure is 422 with its code and the key is free; an
//              exec function that cannot be reached is 503 and the intent is failed EXEC_UNAVAILABLE (key freed); a request that arrives while the
//              intent is executing gets 200 executing and does not start a second run; the caps hold on this path too
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. record_intent: raise the hour cap from 30 to 31 (drizzle/0629)                  -> "the 31st ..." fails
//   2. record_intent: count only drafts towards the caps                                -> "drafts and actions share ..." fails
//   3. actionCreate: call exec even when the intent is a replay of a done one (drafts.ts) -> "the same request again is 200 replayed ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-exec-caps.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import type { AwlConfig, ExecClient } from "../../../supabase/functions/ai-work-link/reads"
import { failure, one, sha256Hex } from "./__test-helpers__/awl-pglite"
import { count, intentRow, mintLink, openWriteDb, recordIntent, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
const config: AwlConfig = { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev", execPresent: true }
const WORK = (n: number) => ({ itemCode: "EX-01", percent: n })
const MEETING = { title: "Weekly review", scheduledAt: "2026-10-01T10:00:00Z" }

let db: PGlite
let n = 0
const key = () => `caps-${++n}`
/** Fills a link's counted history with `k` intents of the given age and status (they only need to exist: the caps count rows). */
const stuff = (linkId: string, user: string, k: number, age: string, status = "failed", kind = "draft") =>
  db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at)
    select 'st-' || md5(random()::text || g::text), '${linkId}', 'org-a', 'proj-a', '${user}', 'record_work_progress', '{}', '${kind}', 'st-' || md5(random()::text || g::text), '${status}', now() + interval '1 day', now() - interval '${age}' from generate_series(1, ${k}) g`)

beforeAll(async () => {
  db = await openWriteDb()
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe("the write caps: 30 an hour and 200 a day per link", () => {
  test("the 31st intent in an hour is WRITE_CAP_HOUR; drafts and actions share the count; nothing is written by the refusal", async () => {
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      for (let i = 0; i < 15; i++) expect((await recordIntent(db, link.token, "draft", "create_meeting", { ...MEETING, title: `d${i}` }, key())).replayed).toBe(false)
      for (let i = 0; i < 15; i++) expect((await recordIntent(db, link.token, "action", "record_work_progress", WORK(i), key())).replayed).toBe(false)
      expect(await count(db, "platform.ai_work_link_intent where link_id = $1", [link.link_id])).toBe(30)
      const rows = await count(db, "platform.ai_work_link_intent")
      const slots = (await one<{ w: number }>(db, "select write_count w from platform.user_ai_links where id = $1", [link.link_id])).w
      const over = await failure(db, "select public.ai_work_link_record_intent($1, 'draft', 'create_meeting', $2::jsonb, $3)", [link.token, JSON.stringify(MEETING), key()])
      expect(over).toMatchObject({ code: "AW429", message: "WRITE_CAP_HOUR" })
      const overAction = await failure(db, "select public.ai_work_link_record_intent($1, 'action', 'record_work_progress', $2::jsonb, $3)", [link.token, JSON.stringify(WORK(99)), key()])
      expect(overAction).toMatchObject({ code: "AW429", message: "WRITE_CAP_HOUR" })
      expect(await count(db, "platform.ai_work_link_intent")).toBe(rows)
      expect((await one<{ w: number }>(db, "select write_count w from platform.user_ai_links where id = $1", [link.link_id])).w).toBe(slots)
    } finally {
      await setWrites(db, false)
    }
  })

  test("a failed intent still counts (a slot spent), and rows older than an hour do not count towards the hour", async () => {
    const a = await mintLink(db, "u-mem", "proj-a")
    await stuff(a.link_id, "u-mem", 29, "10 minutes", "done")
    await stuff(a.link_id, "u-mem", 1, "10 minutes", "failed")
    expect((await failure(db, "select public.ai_work_link_record_intent($1, 'draft', 'create_meeting', $2::jsonb, $3)", [a.token, JSON.stringify(MEETING), key()])).message).toBe("WRITE_CAP_HOUR")

    const b = await mintLink(db, "u-adm", "proj-a")
    await stuff(b.link_id, "u-adm", 30, "2 hours")
    const ok = await recordIntent(db, b.token, "draft", "create_meeting", MEETING, key())
    expect(ok.replayed).toBe(false)
  })

  test("the 201st intent in a day is WRITE_CAP_DAY, though the hour has room", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a2")
    await stuff(link.link_id, "u-mgr", 200, "5 hours")
    const over = await failure(db, "select public.ai_work_link_record_intent($1, 'draft', 'create_meeting', $2::jsonb, $3)", [link.token, JSON.stringify(MEETING), key()])
    expect(over).toMatchObject({ code: "AW429", message: "WRITE_CAP_DAY" })
    // rows older than a day do not count
    const fresh = await mintLink(db, "u-mem", "proj-a2")
    await stuff(fresh.link_id, "u-mem", 200, "30 hours")
    expect((await recordIntent(db, fresh.token, "draft", "create_meeting", MEETING, key())).replayed).toBe(false)
  })

  test("a replay at the cap is answered (it spends nothing), and another link's count is its own", async () => {
    const a = await mintLink(db, "u-mgr", "proj-a")
    const first = await recordIntent(db, a.token, "draft", "create_meeting", MEETING, "at-cap")
    await stuff(a.link_id, "u-mgr", 29, "10 minutes")
    const again = await recordIntent(db, a.token, "draft", "create_meeting", MEETING, "at-cap")
    expect(again).toMatchObject({ replayed: true, intent_id: first.intent_id })
    const other = await mintLink(db, "u-adm", "proj-a2")
    expect((await recordIntent(db, other.token, "draft", "create_meeting", MEETING, key())).replayed).toBe(false)
  })
})

describe("idempotent replay", () => {
  test("the same key is the same intent: one row, one slot, and the confirm code is not returned again", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a")
    const slots = () => one<{ w: number }>(db, "select write_count w from platform.user_ai_links where id = $1", [link.link_id]).then((r) => r.w)
    const first = await recordIntent(db, link.token, "draft", "create_meeting", MEETING, "same-key")
    const w1 = await slots()
    const again = await recordIntent(db, link.token, "draft", "create_meeting", { ...MEETING, title: "A different title, same key" }, "same-key")
    expect(first.replayed).toBe(false)
    expect(first.confirm_token).toMatch(/^[0-9a-f]{64}$/)
    expect(again).toMatchObject({ replayed: true, intent_id: first.intent_id, status: "awaiting_confirmation", confirm_token: null })
    expect(await slots()).toBe(w1)
    expect(await count(db, "platform.ai_work_link_intent where link_id = $1 and idempotency_key = 'same-key'", [link.link_id])).toBe(1)
  })

  test("with no key: the same function and parameters on the same UTC day are one intent, whatever the key order; other parameters are another", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a")
    const a = await recordIntent(db, link.token, "draft", "create_meeting", { title: "Nokey", scheduledAt: "2026-10-05T10:00:00Z" }, null)
    const b = await recordIntent(db, link.token, "draft", "create_meeting", { scheduledAt: "2026-10-05T10:00:00Z", title: "Nokey" }, null)
    const c = await recordIntent(db, link.token, "draft", "create_meeting", { title: "Nokey 2", scheduledAt: "2026-10-05T10:00:00Z" }, null)
    expect(b).toMatchObject({ replayed: true, intent_id: a.intent_id })
    expect(c.replayed).toBe(false)
    expect(c.intent_id).not.toBe(a.intent_id)
    // the derived key is the sha256 of the canonical JSON {function, params, utc_date}
    const row = await intentRow(db, a.intent_id)
    const today = new Date().toISOString().slice(0, 10)
    const canonical = (await one<{ j: string }>(db, "select jsonb_build_object('function', 'create_meeting', 'params', $1::jsonb, 'utc_date', $2::text)::text j", [JSON.stringify({ title: "Nokey", scheduledAt: "2026-10-05T10:00:00Z" }), today])).j
    expect(row.idempotency_key).toBe(sha256Hex(canonical))
  })

  test("a done intent keeps its key and a replay returns its stored outcome; failed, refused and expired intents free the key", async () => {
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const one1 = await recordIntent(db, link.token, "action", "record_work_progress", WORK(1), "done-key")
      await db.query("select public.ai_work_link_intent_claim($1)", [one1.intent_id])
      await db.query(`select public.ai_work_link_intent_finish($1, 'done', 'sub-7', '{"id":"rec-7","route":"/progress/rec-7"}'::jsonb)`, [one1.intent_id])
      expect(await recordIntent(db, link.token, "action", "record_work_progress", WORK(1), "done-key")).toMatchObject({
        replayed: true, intent_id: one1.intent_id, status: "done", submission_id: "sub-7", result: { id: "rec-7", route: "/progress/rec-7" },
      })
      for (const [status, how] of [["failed", "finish"], ["refused", "expire-row"], ["expired", "expire-row"]] as const) {
        const k = `free-${status}`
        const rec = await recordIntent(db, link.token, "action", "record_work_progress", WORK(2), k)
        if (how === "finish") {
          await db.query("select public.ai_work_link_intent_claim($1)", [rec.intent_id])
          await db.query(`select public.ai_work_link_intent_finish($1, 'failed', null, null, '{"code":"SOME_FAILURE"}'::jsonb)`, [rec.intent_id])
        } else {
          await db.exec(`update platform.ai_work_link_intent set status = '${status}' where id = '${rec.intent_id}'`)
        }
        const again = await recordIntent(db, link.token, "action", "record_work_progress", WORK(2), k)
        expect({ status, replayed: again.replayed, sameId: again.intent_id === rec.intent_id }).toEqual({ status, replayed: false, sameId: false })
      }
    } finally {
      await setWrites(db, false)
    }
  })

  test("a live intent past its expiry frees its key on the next request", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a")
    const first = await recordIntent(db, link.token, "draft", "create_meeting", MEETING, "exp-key")
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${first.intent_id}'`)
    const again = await recordIntent(db, link.token, "draft", "create_meeting", MEETING, "exp-key")
    expect(again.replayed).toBe(false)
    expect((await intentRow(db, first.intent_id)).status).toBe("expired")
  })
})

describe("POST /actions through the handler, with a stand-in for the exec function", () => {
  let execCalls: string[]
  let logs: string[]

  /** What the exec host will do for an intent it was handed: finish it in SQL, then answer. */
  const execFinishing = (outcome: "done" | "failed" | "throw" | "slow"): ExecClient => async (intentId) => {
    execCalls.push(intentId)
    if (outcome === "throw") throw new Error("connection reset")
    if (outcome === "slow") return { status: "done" }
    if (outcome === "failed") {
      await db.query(`select public.ai_work_link_intent_finish($1, 'failed', null, null, '{"code":"RECORD_NOT_FOUND","missing":["itemCode"]}'::jsonb)`, [intentId])
      return { status: "failed", code: "RECORD_NOT_FOUND", missing: ["itemCode"] }
    }
    await db.query(`select public.ai_work_link_intent_finish($1, 'done', 'sub-1', '{"id":"rec-1","route":"/progress/rec-1"}'::jsonb)`, [intentId])
    return { status: "done", submission_id: "sub-1", record: { id: "rec-1", route: "/progress/rec-1" } }
  }

  async function act(link: J, body: unknown, exec: ExecClient | undefined): Promise<{ status: number; json: J }> {
    const res = await handleAwl(new Request(`${F}/${link.token}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      config, rpc: rpcFor(db), exec, log: (l) => logs.push(l),
    })
    return { status: res.status, json: (await res.json()) as J }
  }
  const request = (k: string, pct = 10) => ({ function: "record_work_progress", params: WORK(pct), idempotency_key: k })

  test("record, claim, then the exec function once: 201 with the record; the same request again is 200 replayed with the stored record and no second run", async () => {
    execCalls = []
    logs = []
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const first = await act(link, request("act-1"), execFinishing("done"))
      expect(first.status).toBe(201)
      expect(first.json).toMatchObject({ status: "done", record: { id: "rec-1", route: "/progress/rec-1" }, submission_id: "sub-1", replayed: false })
      expect(execCalls).toEqual([first.json.intent_id])
      expect(await intentRow(db, first.json.intent_id)).toMatchObject({ status: "done", submission_id: "sub-1", kind: "action" })

      const again = await act(link, request("act-1"), execFinishing("done"))
      expect(again.status).toBe(200)
      expect(again.json).toMatchObject({ intent_id: first.json.intent_id, status: "done", replayed: true, record: { id: "rec-1", route: "/progress/rec-1" }, submission_id: "sub-1" })
      expect(execCalls).toHaveLength(1)
      expect(await count(db, "platform.ai_work_link_intent where link_id = $1", [link.link_id])).toBe(1)
    } finally {
      await setWrites(db, false)
    }
  })

  test("a failure is 422 with its code and what is missing, the intent is failed, and the same request can run again", async () => {
    execCalls = []
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const bad = await act(link, request("act-fail"), execFinishing("failed"))
      expect(bad.status).toBe(422)
      expect(bad.json).toMatchObject({ code: "RECORD_NOT_FOUND", missing: ["itemCode"] })
      expect((await intentRow(db, execCalls[0])).status).toBe("failed")
      const retry = await act(link, request("act-fail"), execFinishing("done"))
      expect(retry.status).toBe(201)
      expect(execCalls).toHaveLength(2)
      expect(execCalls[1]).not.toBe(execCalls[0])
    } finally {
      await setWrites(db, false)
    }
  })

  test("an exec function that cannot be reached is 503, the intent is failed EXEC_UNAVAILABLE and its key is free", async () => {
    execCalls = []
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const r = await act(link, request("act-down"), execFinishing("throw"))
      expect(r.status).toBe(503)
      expect(r.json).toMatchObject({ code: "EXEC_UNAVAILABLE", available: false })
      expect(await intentRow(db, execCalls[0])).toMatchObject({ status: "failed", failure: { code: "EXEC_UNAVAILABLE", missing: [] } })
      expect((await act(link, request("act-down"), execFinishing("done"))).status).toBe(201)
      // and with no exec client at all (execPresent true but nothing wired): 503 and nothing recorded
      const other = await mintLink(db, "u-mem", "proj-a")
      const none = await act(other, request("act-none"), undefined)
      expect(none.status).toBe(503)
      expect(none.json.code).toBe("EXECUTOR_NOT_AVAILABLE")
      expect(await count(db, "platform.ai_work_link_intent where link_id = $1", [other.link_id])).toBe(0)
    } finally {
      await setWrites(db, false)
    }
  })

  test("a request that arrives while the intent is executing is 200 executing and does not start a second run", async () => {
    execCalls = []
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      // the exec function answers but has not finished the intent yet (slow): the row stays executing
      const first = await act(link, request("act-slow"), execFinishing("slow"))
      expect(first.status).toBe(201)
      expect((await intentRow(db, first.json.intent_id)).status).toBe("executing")
      const second = await act(link, request("act-slow"), execFinishing("done"))
      expect(second.status).toBe(200)
      expect(second.json).toMatchObject({ intent_id: first.json.intent_id, status: "executing", replayed: true })
      expect(execCalls).toEqual([first.json.intent_id])
    } finally {
      await setWrites(db, false)
    }
  })

  test("the caps hold on this path: the 31st action is 429 WRITE_CAP_HOUR and the exec function is not called for it", async () => {
    execCalls = []
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-adm", "proj-a")
      await stuff(link.link_id, "u-adm", 30, "10 minutes")
      const r = await act(link, request("act-cap"), execFinishing("done"))
      expect(r.status).toBe(429)
      expect(r.json.code).toBe("WRITE_CAP_HOUR")
      expect(execCalls).toEqual([])
    } finally {
      await setWrites(db, false)
    }
  })
})
