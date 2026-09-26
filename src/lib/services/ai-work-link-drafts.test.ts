/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09a (register row AW-501; spec 9.2 W-B, 9.3; write-path gap report G4, G5, G12, G17): POST /drafts and GET /drafts/{id} of the
// Edge function ai-work-link, run as the REAL handler (handleAwl, drafts.ts) over the REAL SQL (drizzle/0621 to 0630 on PGlite): no Deno, no network,
// no live database. Drafts are recorded LIVE while writes are OFF: a draft changes nothing until its own person confirms it while signed in.
//
// WHAT IS PROVEN
//   201   one intent row (awaiting_confirmation, 48 hours), and an answer of {draft_id, confirm_url, expires_at}: the confirm code is inside
//         confirm_url's FRAGMENT only, appears once in the whole answer, is stored only as its sha256, and is in no log line and no header
//   200   the same draft again (same idempotency key, or the same parameters on the same day) is a replay: same id, one row, NO confirm_url
//   403   a foreign project, a function that is not on the link, a viewer (rank 1); 400 a read function; 422 missing parameters: none of them
//         writes an intent row
//   503   with no confirm host set: no intent row and no cap slot spent (CONFIRM_HOST_NOT_SET)
//   429   the 31st draft in an hour and the 201st in a day, each with its own code
//   never any business row: a draft writes nothing to submissions or pipeline_tasks
//   GET /drafts/{id}  this link's own draft, in words; another link's draft and an action id are 404
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. POST /drafts answers 501 again (drafts.ts: throw before recording)     -> the 201 test, the replay, the caps and the GET tests fail
//   2. record the draft before checking the parameters (skip checkChange)      -> "422 with what is missing writes no intent row" fails
//   3. put the confirm code in the JSON body outside the URL                   -> "the confirm code appears once" fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-drafts.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import type { AwlConfig } from "../../../supabase/functions/ai-work-link/reads"
import { one, sha256Hex } from "./__test-helpers__/awl-pglite"
import { count, intentRow, mintLink, openWriteDb, recordIntent, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
const HOST = "inbox-test.pages.dev"
const config: AwlConfig = { ...configFromEnv(() => undefined), confirmHost: HOST }
const noHost: AwlConfig = { ...configFromEnv(() => undefined) } // the .invalid default

let db: PGlite
let logs: string[]
let sqlSeen: string[]
let mgr: J
let n = 0

async function call(link: J, path: string, init: { method?: string; body?: unknown; config?: AwlConfig } = {}): Promise<{ status: number; json: J; text: string; headers: Headers }> {
  const method = init.method ?? "GET"
  const res = await handleAwl(
    new Request(`${F}/${link.token}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(init.body ?? {}) : undefined }),
    { config: init.config ?? config, rpc: rpcFor(db, sqlSeen), log: (l) => logs.push(l) },
  )
  const text = await res.text()
  let json: J = {}
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON (a Markdown answer)
  }
  return { status: res.status, json, text, headers: res.headers }
}

const MEETING = { title: "Weekly review", scheduledAt: "2026-10-01T10:00:00Z" }
const draftBody = (over: Record<string, unknown> = {}) => ({ function: "create_meeting", params: MEETING, idempotency_key: `k-${++n}`, ...over })
const intents = (linkId: string) => count(db, "platform.ai_work_link_intent where link_id = $1", [linkId])
const businessRows = async () => (await count(db, "compliance.submissions")) + (await count(db, "compliance.pipeline_tasks"))

beforeAll(async () => {
  db = await openWriteDb()
  mgr = await mintLink(db, "u-mgr", "proj-a")
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe("POST /drafts records a draft, live, while writes are off", () => {
  test("201: one intent row, awaiting confirmation for 48 hours, and an answer of draft_id, confirm_url and expires_at", async () => {
    logs = []
    sqlSeen = []
    const before = await businessRows()
    expect((await one<{ w: boolean }>(db, "select writes_enabled w from platform.ai_work_link_settings")).w).toBe(false)
    const r = await call(mgr, "/drafts", { method: "POST", body: draftBody() })

    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ status: "awaiting_confirmation", kind: "draft", function: "create_meeting", replayed: false })
    expect(typeof r.json.draft_id).toBe("string")
    expect(r.json.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const row = await intentRow(db, r.json.draft_id)
    expect(row).toMatchObject({ kind: "draft", status: "awaiting_confirmation", function_id: "create_meeting", link_id: mgr.link_id, user_id: "u-mgr", project_id: "proj-a" })
    const hours = (await one<{ h: number }>(db, "select round(extract(epoch from (expires_at - created_at)) / 3600)::int h from platform.ai_work_link_intent where id = $1", [r.json.draft_id])).h
    expect(hours).toBe(48)
    expect(await intents(mgr.link_id)).toBe(1)
    // recorded, not run: no submission, no task, no business row of any kind
    expect(await businessRows()).toBe(before)
    expect(sqlSeen).toContain("ai_work_link_record_intent")
    expect(sqlSeen).not.toContain("ai_work_link_intent_claim")
    expect(r.json.status_url).toBe(`${F}/${mgr.token}/drafts/${r.json.draft_id}`)
  })

  test("the confirm code is in the fragment of confirm_url only: once in the whole answer, hashed at rest, and in no log line or header", async () => {
    logs = []
    const r = await call(mgr, "/drafts", { method: "POST", body: draftBody() })
    expect(r.status).toBe(201)
    const url = new URL(r.json.confirm_url)
    expect(url.origin).toBe(`https://${HOST}`)
    expect(url.pathname).toBe("/ai-confirm.html")
    expect(url.search).toBe("")
    const m = /^#d=([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(url.hash)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(r.json.draft_id)
    const code = m![2]
    expect(r.text.split(code).length - 1).toBe(1)
    expect(Object.keys(r.json)).not.toContain("confirm_token")
    // stored only as its sha256
    expect((await intentRow(db, r.json.draft_id)).confirm_token_hash).toBe(sha256Hex(code))
    for (const l of logs) expect(l).not.toContain(code)
    for (const [, v] of r.headers) expect(v).not.toContain(code)
  })

  test("a draft is recorded whatever the link's stored level: a level-0 link and a level-1 link both draft", async () => {
    const zero = await mintLink(db, "u-mgr", "proj-a2", { level: 0 })
    const r = await call(zero, "/drafts", { method: "POST", body: draftBody() })
    expect(r.status).toBe(201)
    expect((await intentRow(db, r.json.draft_id)).kind).toBe("draft")
  })

  test("200 on a replay: the same draft, one row, and no confirm_url (the code was shown once)", async () => {
    const body = draftBody({ idempotency_key: "replay-1" })
    const first = await call(mgr, "/drafts", { method: "POST", body })
    const rows = await intents(mgr.link_id)
    const again = await call(mgr, "/drafts", { method: "POST", body })

    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ draft_id: first.json.draft_id, replayed: true, status: "awaiting_confirmation" })
    expect(again.json.confirm_url).toBeUndefined()
    expect(again.json.hint).toContain("cannot be shown again")
    expect(again.text).not.toContain(/[0-9a-f]{64}/.exec(first.json.confirm_url)![0])
    expect(await intents(mgr.link_id)).toBe(rows)
  })

  test("with no idempotency_key the same parameters on the same day are one draft", async () => {
    const body = { function: "create_meeting", params: { title: "No key", scheduledAt: "2026-10-02T10:00:00Z" } }
    const a = await call(mgr, "/drafts", { method: "POST", body })
    const b = await call(mgr, "/drafts", { method: "POST", body })
    expect([a.status, b.status]).toEqual([201, 200])
    expect(b.json.draft_id).toBe(a.json.draft_id)
  })
})

describe("what is refused writes no intent row", () => {
  test("422 with what is missing writes no intent row and spends no cap slot", async () => {
    const before = await intents(mgr.link_id)
    const r = await call(mgr, "/drafts", { method: "POST", body: { function: "create_meeting", params: { title: "no time" } } })
    expect(r.status).toBe(422)
    expect(r.json).toMatchObject({ code: "PARAMS_INVALID", missing: ["scheduledAt"] })
    const long = await call(mgr, "/drafts", { method: "POST", body: { function: "create_meeting", params: { ...MEETING, title: "x".repeat(2001) } } })
    expect(long.status).toBe(422)
    expect(await intents(mgr.link_id)).toBe(before)
  })

  test("403 for another project, a function that is not on the link, and a viewer; 400 for a read function", async () => {
    const before = await intents(mgr.link_id)
    const wrong = await call(mgr, "/drafts", { method: "POST", body: { function: "create_meeting", params: { ...MEETING, projectId: "proj-b" } } })
    expect(wrong.status).toBe(403)
    expect(wrong.json.code).toBe("WRONG_PROJECT")
    const off = await call(mgr, "/drafts", { method: "POST", body: { function: "review_budget", params: {} } })
    expect(off.status).toBe(403)
    expect(off.json.code).toBe("FUNCTION_NOT_ON_LINK")
    const viewer = await mintLink(db, "u-view", "proj-a", { level: 0 })
    const v = await call(viewer, "/drafts", { method: "POST", body: draftBody() })
    expect(v.status).toBe(403)
    expect(v.json.code).toBe("FUNCTION_NOT_ON_LINK")
    const read = await call(mgr, "/drafts", { method: "POST", body: { function: "get_construction_project_dashboard", params: {} } })
    expect(read.status).toBe(400)
    expect(await intents(mgr.link_id)).toBe(before)
    expect(await intents(viewer.link_id)).toBe(0)
  })

  test("503 CONFIRM_HOST_NOT_SET when no confirm host is configured: nothing is recorded, so no code is minted and thrown away", async () => {
    const link = await mintLink(db, "u-mem", "proj-a")
    sqlSeen = []
    const r = await call(link, "/drafts", { method: "POST", body: draftBody(), config: noHost })
    expect(r.status).toBe(503)
    expect(r.json.code).toBe("CONFIRM_HOST_NOT_SET")
    expect(await intents(link.link_id)).toBe(0)
    expect(sqlSeen).not.toContain("ai_work_link_record_intent")
    // and the same request with a host is recorded
    expect((await call(link, "/drafts", { method: "POST", body: draftBody() })).status).toBe(201)
  })

  test("a bad idempotency_key is 400 and records nothing", async () => {
    const before = await intents(mgr.link_id)
    for (const bad of [42, "k".repeat(129), { a: 1 }]) {
      const r = await call(mgr, "/drafts", { method: "POST", body: { function: "create_meeting", params: MEETING, idempotency_key: bad } })
      expect(r.status).toBe(400)
    }
    expect(await intents(mgr.link_id)).toBe(before)
  })
})

describe("the write caps say which one was hit", () => {
  test("30 an hour: the 31st draft is 429 WRITE_CAP_HOUR; 200 a day: the 201st is 429 WRITE_CAP_DAY", async () => {
    const hourly = await mintLink(db, "u-adm", "proj-a")
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at)
      select 'cap-h-' || g, '${hourly.link_id}', 'org-a', 'proj-a', 'u-adm', 'create_meeting', '{}', 'draft', 'cap-h-' || g, 'failed', now() + interval '1 day', now() - interval '10 minutes' from generate_series(1, 30) g`)
    const h = await call(hourly, "/drafts", { method: "POST", body: draftBody() })
    expect(h.status).toBe(429)
    expect(h.json.code).toBe("WRITE_CAP_HOUR")

    const other = await mintLink(db, "u-mem", "proj-a2")
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at)
      select 'cap-d-' || g, '${other.link_id}', 'org-a', 'proj-a2', 'u-mem', 'create_meeting', '{}', 'draft', 'cap-d-' || g, 'failed', now() + interval '1 day', now() - interval '5 hours' from generate_series(1, 200) g`)
    const d = await call(other, "/drafts", { method: "POST", body: draftBody() })
    expect(d.status).toBe(429)
    expect(d.json.code).toBe("WRITE_CAP_DAY")
  })
})

describe("GET /drafts/{id}: the state of this link's own draft", () => {
  test("waiting, in JSON and in Markdown, with what to do next; nothing is written by reading it", async () => {
    const made = await call(mgr, "/drafts", { method: "POST", body: draftBody() })
    const before = await count(db, "platform.ai_work_link_intent")
    const j = await call(mgr, `/drafts/${made.json.draft_id}?format=json`)
    expect(j.status).toBe(200)
    expect(j.json).toMatchObject({ draft_id: made.json.draft_id, kind: "draft", status: "awaiting_confirmation", function_id: "create_meeting" })
    expect(j.json.next).toContain("Waiting for the person")
    expect(j.text).not.toMatch(/[0-9a-f]{64}/)
    const md = await call(mgr, `/drafts/${made.json.draft_id}`)
    expect(md.status).toBe(200)
    expect(md.text.startsWith("# Change or draft status")).toBe(true)
    expect(await count(db, "platform.ai_work_link_intent")).toBe(before)
  })

  test("another link's draft is 404, an unknown id is 404, and an action's id is not a draft (404)", async () => {
    const theirs = await mintLink(db, "u-mem", "proj-a")
    const t = await call(theirs, "/drafts", { method: "POST", body: draftBody() })
    expect((await call(mgr, `/drafts/${t.json.draft_id}?format=json`)).status).toBe(404)
    expect((await call(mgr, "/drafts/no-such-draft?format=json")).status).toBe(404)
    await setWrites(db, true)
    try {
      const action = await recordIntent(db, mgr.token, "action", "record_attendance", { rosterId: "ro-1", date: "2026-09-26" }, `act-${++n}`)
      const a = await call(mgr, `/drafts/${action.intent_id}?format=json`)
      expect(a.status).toBe(404)
    } finally {
      await setWrites(db, false)
    }
  })

  test("a draft past its expiry reads expired, without anything being written by the read", async () => {
    const made = await call(mgr, "/drafts", { method: "POST", body: draftBody() })
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${made.json.draft_id}'`)
    const r = await call(mgr, `/drafts/${made.json.draft_id}?format=json`)
    expect(r.json.status).toBe("expired")
    expect((await intentRow(db, made.json.draft_id)).status).toBe("awaiting_confirmation") // stored state unchanged by a GET
  })
})
