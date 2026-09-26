/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09a (register rows AW-503, AW-507, AW-508 in part; write-path gap report G2, G4, G11, G13, G18): drizzle/0629, the SQL that lets a
// write of the Universal AI Work Link be claimed, finished and read honestly, proved on PGlite (real Postgres as WASM) with the migrations 0621 to 0630
// applied. Writes are OFF unless a test switches them on for its own duration. No live database is touched.
//
// WHAT IS PROVEN
//   live      ai_work_link__live(link id) answers exactly what ai_work_link__resolve(token) answers, in every state (manager, member, a demotion,
//             a private project, a deactivated person, a revoked link, an expired link): the copy cannot drift without this failing
//   claim     writes off: {not_enabled} and NOTHING changes; on: a recorded action or a confirmed draft moves to executing once (a second claim is
//             refused), an unconfirmed draft, an unknown id and an expired intent are refused; a demotion between record and claim refuses the
//             intent ROLE_CHANGED and a revoked link or a deactivated person refuses it LINK_GONE, each recorded on the intent, and the key is
//             free again
//   finish    the only way out of executing: the result is kept as {id, route} and the failure as {code, missing} and nothing else (a message,
//             a token or a connection string cannot be stored), a second finish changes nothing and returns the stored outcome
//   stale     an executing intent that ran more than 10 minutes reads failed EXECUTION_UNCERTAIN, and a GET does not write it; the next POST
//             (record_intent or claim) does, which frees its key; a confirmed draft past its expiry reads and becomes expired
//   confirm   another person and a wrong code are refused while writes are OFF (BR-497's 403 half); only the owner's valid, pending confirm
//             reaches the switch, waits, and consumes nothing
//   draft state, warning, retention (the intent purge) and the new column
//
// Falsifiability (each break was made in drizzle/0629_build001_awl_execution_sql.sql, the named test failed, the file was restored byte for byte):
//   1. claim ignores the writes switch                                   -> "writes off: not_enabled and nothing changes" fails
//   2. claim never sets LINK_GONE (2), or never sets ROLE_CHANGED (2b)    -> the LINK_GONE test (2), the ROLE_CHANGED test (2b) fail
//   3. draft_confirm checks the switch first again (the 0626 order)      -> "while writes are off ... another person is 403" fails
//   4. finish stores the failure as it was sent                          -> "finish keeps only {code, missing} ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-execution-sql.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { failure, forwardSql, one } from "./__test-helpers__/awl-pglite"
import { AUTH, count, intentRow, mintLink, openWriteDb, recordIntent, setWrites, type J } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

let db: PGlite
let n = 0
const key = () => `k-${++n}`
const P = { itemCode: "EX-01", percent: 10 }
const ATT = { rosterId: "ro-1", date: "2026-09-26" }

const claim = async (id: string) => (await one<{ r: J }>(db, "select public.ai_work_link_intent_claim($1) r", [id])).r
const finish = async (id: string, status: string, o: { submission?: string | null; result?: unknown; failure?: unknown } = {}) =>
  (await one<{ r: J }>(db, "select public.ai_work_link_intent_finish($1, $2, $3, $4::jsonb, $5::jsonb) r", [id, status, o.submission ?? null, o.result === undefined ? null : JSON.stringify(o.result), o.failure === undefined ? null : JSON.stringify(o.failure)])).r
const confirm = async (id: string, token: string | null, actor: string) => (await one<{ r: J }>(db, "select public.ai_work_link_draft_confirm($1, $2, $3) r", [id, token, actor])).r
const live = async (linkId: string) => (await one<{ r: J }>(db, "select public.ai_work_link__live($1) r", [linkId])).r
const resolve = async (token: string) => (await one<{ r: J }>(db, "select public.ai_work_link__resolve($1) r", [token])).r
const setRole = (user: string, role: string) => db.exec(`update compliance.users set role = '${role}' where id = '${user}'`)
/** A fresh level-1 link for the person, and one recorded action of `record_work_progress` on it (the switch must be on). */
async function action(user = "u-mgr", project = "proj-a", fn = "record_work_progress", params: unknown = P) {
  const link = await mintLink(db, user, project)
  const rec = await recordIntent(db, link.token, "action", fn, params, key())
  return { link, id: rec.intent_id as string }
}

beforeAll(async () => {
  db = await openWriteDb()
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe("ai_work_link__live: the live link by id equals resolve by token", () => {
  test("in every state: manager, member, a demotion, a private project, a deactivated person, a revoked link, an expired link, writes on and off", async () => {
    const check = async (label: string, link: J) => expect({ label, live: await live(link.link_id) }).toEqual({ label, live: await resolve(link.token) })
    const mgr = await mintLink(db, "u-mgr", "proj-a")
    await check("manager, writes off", mgr)
    await setWrites(db, true)
    try {
      await check("manager, writes on", mgr)
      const mem = await mintLink(db, "u-mem", "proj-a")
      await check("member", mem)
      await setRole("u-mem", "viewer")
      await check("member demoted to viewer", mem)
      await setRole("u-mem", "member")
      await setRole("u-mgr", "member")
      await check("manager demoted to member", mgr)
      await setRole("u-mgr", "manager")
      await db.exec("update compliance.projects set access_level = 'private', lead_user_id = 'u-adm' where id = 'proj-a2'")
      const priv = await mintLink(db, "u-adm", "proj-a2")
      await check("private project, its admin", priv)
      await db.exec("update compliance.projects set lead_user_id = 'u-mgr' where id = 'proj-a2'")
      await db.exec("update compliance.users set role = 'member' where id = 'u-adm'")
      await check("private project, the person no longer an admin or its lead", priv)
      await db.exec("update compliance.users set role = 'admin' where id = 'u-adm'")
      await db.exec("update compliance.projects set access_level = 'public' where id = 'proj-a2'")
      await db.exec("update compliance.users set is_active = false where id = 'u-mem'")
      await check("deactivated person", mem)
      await db.exec("update compliance.users set is_active = true where id = 'u-mem'")
      const revoked = await mintLink(db, "u-view", "proj-a", { level: 0 })
      await db.exec(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = '${revoked.link_id}'`)
      await check("revoked", revoked)
      const expired = await mintLink(db, "u-view", "proj-a2", { level: 0 })
      await db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 minute' where id = '${expired.link_id}'`)
      await check("expired", expired)
      expect(await live("no-such-link")).toEqual({ status: "gone" })
      expect(await live(null as unknown as string)).toEqual({ status: "gone" })
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("ai_work_link_intent_claim", () => {
  test("writes off: not_enabled and NOTHING changes (the intent stays recorded, claimed_at stays null)", async () => {
    await setWrites(db, true)
    const a = await action()
    await setWrites(db, false)
    const r = await claim(a.id)
    expect(r).toEqual({ status: "not_enabled" })
    expect(await intentRow(db, a.id)).toMatchObject({ status: "recorded", claimed_at: null, failure: null })
  })

  test("writes on: a recorded action moves to executing once, with the live person and project for the executor; a second claim is refused", async () => {
    await setWrites(db, true)
    try {
      const a = await action()
      const r = await claim(a.id)
      expect(r).toEqual({
        status: "ok",
        intent: { id: a.id, kind: "action", function_id: "record_work_progress", params: P },
        ctx: { link_id: a.link.link_id, org_id: "org-a", user_id: "u-mgr", project_id: "proj-a", live_role: "manager", live_rank: 3, effective_level: 1, money_visible: true },
      })
      const row = await intentRow(db, a.id)
      expect(row.status).toBe("executing")
      expect(row.claimed_at).not.toBeNull()
      expect(await claim(a.id)).toEqual({ status: "refused", reason: "already_executing" })
    } finally {
      await setWrites(db, false)
    }
  })

  test("a draft runs only after its own person confirmed it; an unknown id and an expired action are refused", async () => {
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const d = await recordIntent(db, link.token, "draft", "add_roster_entry", { name: "Ravi", dailyRate: 500 }, key())
      expect(await claim(d.intent_id)).toEqual({ status: "refused", reason: "not_claimable", current: "awaiting_confirmation" })
      expect((await confirm(d.intent_id, d.confirm_token, "u-mgr")).status).toBe("confirmed")
      // a confirmed row that names another person as its confirmer is not run
      await db.exec(`update platform.ai_work_link_intent set confirmed_by = 'u-mem' where id = '${d.intent_id}'`)
      expect(await claim(d.intent_id)).toEqual({ status: "refused", reason: "not_confirmed_by_owner" })
      await db.exec(`update platform.ai_work_link_intent set confirmed_by = 'u-mgr' where id = '${d.intent_id}'`)
      const ok = await claim(d.intent_id)
      expect(ok).toMatchObject({ status: "ok", intent: { kind: "draft", function_id: "add_roster_entry" } })
      expect(await claim("no-such-intent")).toEqual({ status: "refused", reason: "not_found" })

      const a = await action()
      await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${a.id}'`)
      expect(await claim(a.id)).toEqual({ status: "refused", reason: "expired" })
      expect((await intentRow(db, a.id)).status).toBe("expired")
    } finally {
      await setWrites(db, false)
    }
  })

  test("a demotion between record and claim refuses the intent ROLE_CHANGED, on the intent, and its key is free again", async () => {
    await setWrites(db, true)
    try {
      const a = await action("u-mem", "proj-a")
      await setRole("u-mem", "viewer")
      const r = await claim(a.id)
      expect(r).toEqual({ status: "refused", reason: "ROLE_CHANGED" })
      expect(await intentRow(db, a.id)).toMatchObject({ status: "refused", failure: { code: "ROLE_CHANGED", missing: [] } })
      // a confirmed level-2 draft is refused the same way: the function left the person's effective list
      const link = await mintLink(db, "u-mgr", "proj-a2")
      const d = await recordIntent(db, link.token, "draft", "add_roster_entry", { name: "Sita", dailyRate: 450 }, key())
      await confirm(d.intent_id, d.confirm_token, "u-mgr")
      await setRole("u-mgr", "viewer")
      expect(await claim(d.intent_id)).toEqual({ status: "refused", reason: "ROLE_CHANGED" })
      await setRole("u-mgr", "manager")
      await setRole("u-mem", "member")
      // a fresh action with the same key is accepted again: a refused intent freed it (the partial unique index)
      const again = await recordIntent(db, (await mintLink(db, "u-mem", "proj-a")).token, "action", "record_work_progress", P, "reuse-key")
      expect(again.replayed).toBe(false)
    } finally {
      await setWrites(db, false)
      await setRole("u-mgr", "manager")
      await setRole("u-mem", "member")
    }
  })

  test("a revoked link, a link past its expiry and a deactivated person refuse the intent LINK_GONE", async () => {
    await setWrites(db, true)
    try {
      const a = await action("u-mgr", "proj-a")
      await db.exec(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = '${a.link.link_id}'`)
      expect(await claim(a.id)).toEqual({ status: "refused", reason: "LINK_GONE" })
      expect(await intentRow(db, a.id)).toMatchObject({ status: "refused", failure: { code: "LINK_GONE" } })

      const b = await action("u-mem", "proj-a")
      await db.exec("update compliance.users set is_active = false where id = 'u-mem'")
      expect(await claim(b.id)).toEqual({ status: "refused", reason: "LINK_GONE" })
      await db.exec("update compliance.users set is_active = true where id = 'u-mem'")

      const c = await action("u-mgr", "proj-a2")
      await db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 second' where id = '${c.link.link_id}'`)
      expect(await claim(c.id)).toEqual({ status: "refused", reason: "LINK_GONE" })
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("ai_work_link_intent_finish", () => {
  const claimed = async (fn = "record_work_progress", params: unknown = P) => {
    const a = await action("u-mgr", "proj-a", fn, params)
    expect((await claim(a.id)).status).toBe("ok")
    return a
  }

  test("done keeps only {id, route}, sets the submission and the time; a second finish changes nothing and returns the stored outcome", async () => {
    await setWrites(db, true)
    try {
      const a = await claimed()
      const r = await finish(a.id, "done", { submission: "sub-1", result: { id: "rec-1", route: "/progress/rec-1", record: { dailyRate: 999, secret: "x" }, message: "postgres://u:p@h/db" } })
      expect(r).toMatchObject({ intent_id: a.id, status: "done", submission_id: "sub-1", result: { id: "rec-1", route: "/progress/rec-1" }, failure: null, updated: true })
      expect(Object.keys(r.result).sort()).toEqual(["id", "route"])
      const row = await intentRow(db, a.id)
      expect(row.status).toBe("done")
      expect(row.executed_at).not.toBeNull()
      // a later, different finish is refused by the state, and reads back what was stored
      const second = await finish(a.id, "failed", { failure: { code: "SOMETHING" } })
      expect(second).toMatchObject({ status: "done", updated: false, submission_id: "sub-1", result: { id: "rec-1", route: "/progress/rec-1" } })
      expect((await intentRow(db, a.id)).failure).toBeNull()
      expect(await finish("no-such", "done", {})).toEqual({ status: "refused", reason: "not_found" })
    } finally {
      await setWrites(db, false)
    }
  })

  test("finish keeps only {code, missing} of a failure: a message, an odd code, long or too many names cannot be stored; the key is freed", async () => {
    await setWrites(db, true)
    try {
      const a = await claimed()
      const r = await finish(a.id, "failed", {
        failure: { code: "RECORD_NOT_FOUND", missing: ["itemCode", "x".repeat(200), ...Array.from({ length: 30 }, (_, i) => `m${i}`)], message: "connection string postgres://u:p@h/db", debug: "token pxa_abc" },
      })
      expect(r.status).toBe("failed")
      expect(Object.keys(r.failure).sort()).toEqual(["code", "missing"])
      expect(r.failure.code).toBe("RECORD_NOT_FOUND")
      expect(r.failure.missing).toHaveLength(20)
      expect(r.failure.missing[0]).toBe("itemCode")
      expect(r.failure.missing[1]).toHaveLength(64)
      expect(JSON.stringify(await intentRow(db, a.id))).not.toContain("postgres://")
      const odd = await claimed()
      const o = await finish(odd.id, "failed", { failure: { code: "not a code; drop table", missing: "nope" } })
      expect(o.failure).toEqual({ code: "UNKNOWN", missing: [] })
      // a failed intent freed its key: the same request is accepted again
      const link = await mintLink(db, "u-mgr", "proj-a")
      const first = await recordIntent(db, link.token, "action", "record_work_progress", P, "free-me")
      await claim(first.intent_id)
      await finish(first.intent_id, "failed", { failure: { code: "X_FAIL" } })
      expect((await recordIntent(db, link.token, "action", "record_work_progress", P, "free-me")).replayed).toBe(false)
    } finally {
      await setWrites(db, false)
    }
  })

  test("bad input is a coded error and changes nothing: an unknown status, no failure for a failed intent, a result that is not an object", async () => {
    await setWrites(db, true)
    try {
      const a = await claimed()
      expect((await failure(db, "select public.ai_work_link_intent_finish($1, 'executing')", [a.id])).code).toBe("AW400")
      expect((await failure(db, "select public.ai_work_link_intent_finish($1, 'failed')", [a.id])).code).toBe("AW400")
      expect((await failure(db, "select public.ai_work_link_intent_finish($1, 'done', null, '[1]'::jsonb)", [a.id])).code).toBe("AW400")
      expect((await failure(db, "select public.ai_work_link_intent_finish($1, 'done', $2)", [a.id, "s".repeat(129)])).code).toBe("AW400")
      expect((await intentRow(db, a.id)).status).toBe("executing")
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("a stale executing intent, and a confirmed draft past its expiry", () => {
  test("reads failed EXECUTION_UNCERTAIN without a GET writing anything; the next POST writes it and frees the key", async () => {
    await setWrites(db, true)
    try {
      const link = await mintLink(db, "u-mgr", "proj-a")
      const rec = await recordIntent(db, link.token, "action", "record_work_progress", P, "stale-1")
      await claim(rec.intent_id)
      await db.exec(`update platform.ai_work_link_intent set claimed_at = now() - interval '11 minutes' where id = '${rec.intent_id}'`)
      const status = (await one<{ r: J }>(db, "select public.ai_work_link_intent_status($1, $2) r", [link.token, rec.intent_id])).r
      expect(status).toMatchObject({ status: "failed", failure: { code: "EXECUTION_UNCERTAIN", missing: [] } })
      const hist = (await one<{ r: J }>(db, "select public.ai_work_link_history($1, 50) r", [link.token])).r
      expect(hist.items.find((i: J) => i.intent_id === rec.intent_id)).toMatchObject({ status: "failed", failure: { code: "EXECUTION_UNCERTAIN" } })
      // the reads wrote nothing
      expect((await intentRow(db, rec.intent_id)).status).toBe("executing")
      // a request with the same key: the sweep of the POST marks it failed, so the key is free and a new intent is recorded
      const again = await recordIntent(db, link.token, "action", "record_work_progress", P, "stale-1")
      expect(again.replayed).toBe(false)
      expect(again.intent_id).not.toBe(rec.intent_id)
      expect(await intentRow(db, rec.intent_id)).toMatchObject({ status: "failed", failure: { code: "EXECUTION_UNCERTAIN", missing: [] } })
      // an executing intent that is NOT stale still holds its key
      await claim(again.intent_id)
      expect((await recordIntent(db, link.token, "action", "record_work_progress", P, "stale-1")).replayed).toBe(true)
    } finally {
      await setWrites(db, false)
    }
  })

  test("claim of a stale executing row is refused (never retried); a confirmed draft past its expiry reads expired and is swept", async () => {
    await setWrites(db, true)
    try {
      const a = await action("u-mgr", "proj-a2")
      await claim(a.id)
      await db.exec(`update platform.ai_work_link_intent set claimed_at = now() - interval '30 minutes' where id = '${a.id}'`)
      expect(await claim(a.id)).toEqual({ status: "refused", reason: "not_claimable", current: "failed" })

      const link = await mintLink(db, "u-mem", "proj-a")
      const d = await recordIntent(db, link.token, "draft", "add_roster_entry", { name: "Old", dailyRate: 1 }, key())
      await confirm(d.intent_id, d.confirm_token, "u-mem")
      await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${d.intent_id}'`)
      const view = (await one<{ r: J }>(db, "select public.ai_work_link_intent_status($1, $2) r", [link.token, d.intent_id])).r
      expect(view.status).toBe("expired")
      expect((await intentRow(db, d.intent_id)).status).toBe("confirmed") // a read does not write
      expect(await claim(d.intent_id)).toEqual({ status: "refused", reason: "expired" })
      expect((await intentRow(db, d.intent_id)).status).toBe("expired")
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("ai_work_link_draft_confirm: owner, code and state are checked BEFORE the switch", () => {
  const draft = async (user = "u-mgr", project = "proj-a") => {
    const link = await mintLink(db, user, project)
    return recordIntent(db, link.token, "draft", "add_roster_entry", { name: "Ravi", dailyRate: 500 }, key())
  }

  test("while writes are off: another person is not_owner, a wrong or missing code is not_found, an unknown draft is not_found; only the owner's valid confirm reaches the switch and waits", async () => {
    const d = await draft()
    expect((await one<{ w: boolean }>(db, "select writes_enabled w from platform.ai_work_link_settings")).w).toBe(false)
    expect(await confirm(d.intent_id, d.confirm_token, "u-mem")).toEqual({ status: "refused", reason: "not_owner" })
    expect(await confirm(d.intent_id, "0".repeat(64), "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
    expect(await confirm(d.intent_id, null, "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
    expect(await confirm("no-such-draft", d.confirm_token, "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
    // the owner, right code, writes off: waits, and nothing is consumed
    expect(await confirm(d.intent_id, d.confirm_token, "u-mgr")).toEqual({ status: "not_enabled" })
    expect(await intentRow(db, d.intent_id)).toMatchObject({ status: "awaiting_confirmation", confirmed_at: null, confirmed_by: null })
    // the same code works once writes are on, exactly once
    await setWrites(db, true)
    try {
      expect((await confirm(d.intent_id, d.confirm_token, "u-mgr")).status).toBe("confirmed")
      expect(await confirm(d.intent_id, d.confirm_token, "u-mgr")).toEqual({ status: "refused", reason: "not_pending" })
    } finally {
      await setWrites(db, false)
    }
  })

  test("an expired draft is refused expired (and marked) even while writes are off", async () => {
    const d = await draft("u-mem", "proj-a")
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${d.intent_id}'`)
    expect(await confirm(d.intent_id, d.confirm_token, "u-mem")).toEqual({ status: "refused", reason: "expired" })
    expect((await intentRow(db, d.intent_id)).status).toBe("expired")
  })
})

describe("ai_work_link_draft_state", () => {
  test("the owner with the code sees the draft, with writes off; another person and a wrong code do not", async () => {
    const link = await mintLink(db, "u-mgr", "proj-a")
    const d = await recordIntent(db, link.token, "draft", "add_roster_entry", { name: "Ravi", dailyRate: 48123 }, key())
    const state = async (actor: string, token: string | null) => (await one<{ r: J }>(db, "select public.ai_work_link_draft_state($1, $2, $3) r", [d.intent_id, actor, token])).r
    const ok = await state("u-mgr", d.confirm_token)
    expect(ok).toMatchObject({ status: "ok", draft: { id: d.intent_id, function_id: "add_roster_entry", params: { name: "Ravi", dailyRate: 48123 }, state: "awaiting_confirmation", writes_enabled: false } })
    expect(JSON.stringify(ok)).not.toContain(d.confirm_token)
    expect(await state("u-mem", d.confirm_token)).toEqual({ status: "refused", reason: "not_owner" })
    expect(await state("u-mgr", "0".repeat(64))).toEqual({ status: "refused", reason: "not_found" })
    expect(await state("u-mgr", null)).toEqual({ status: "refused", reason: "not_found" })
    // a draft that has been confirmed is still readable by its owner with the same code (a failed run can be re-driven)
    await setWrites(db, true)
    try {
      await confirm(d.intent_id, d.confirm_token, "u-mgr")
      expect((await state("u-mgr", d.confirm_token)).draft.state).toBe("confirmed")
    } finally {
      await setWrites(db, false)
    }
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${d.intent_id}'`)
    expect((await state("u-mgr", d.confirm_token)).draft.state).toBe("expired")
  })
})

describe("the warning sentence, the retention purge and the column", () => {
  test("the warning no longer promises to record while writes are off (G13); it does once they are on", async () => {
    const warn = async (level: number) => (await one<{ r: J }>(db, "select public.ai_work_link_warning($1::uuid, 'proj-a', $2) r", [AUTH.mgr, level])).r
    const off = await warn(1)
    expect(off.can_record).toBe(false)
    expect(off.sentence).toContain("It cannot change anything without your click.")
    expect(off.sentence).toContain("Recording entries directly is not switched on yet")
    expect(off.sentence).not.toContain("record daily entries")
    await setWrites(db, true)
    try {
      const on = await warn(1)
      expect(on.can_record).toBe(true)
      expect(on.sentence).toContain("record daily entries in your name")
      expect((await warn(0)).can_record).toBe(false)
    } finally {
      await setWrites(db, false)
    }
  })

  test("0629's warning and 0631's warning_for say the same sentence in every state (they cannot contradict each other)", async () => {
    await db.exec(forwardSql("0631_build001_awl_mint_for"))
    for (const writes of [false, true]) {
      await setWrites(db, writes)
      try {
        for (const level of [0, 1]) {
          const old = (await one<{ r: J }>(db, "select public.ai_work_link_warning($1::uuid, 'proj-a', $2) r", [AUTH.mgr, level])).r
          const forUser = (await one<{ r: J }>(db, "select public.ai_work_link_warning_for('u-mgr', 'proj-a', $1) r", [level])).r
          expect({ writes, level, sentence: old.sentence }).toEqual({ writes, level, sentence: forUser.sentence })
        }
      } finally {
        await setWrites(db, false)
      }
    }
  })

  test("retention deletes intents older than the keep days and keeps the rest; the call-log work is unchanged", async () => {
    const link = await mintLink(db, "u-adm", "proj-a")
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at) values
      ('old-1', '${link.link_id}', 'org-a', 'proj-a', 'u-adm', 'add_roster_entry', '{"dailyRate": 1}', 'draft', 'old-1', 'done', now() - interval '99 days', now() - interval '100 days'),
      ('old-2', '${link.link_id}', 'org-a', 'proj-a', 'u-adm', 'add_roster_entry', '{"dailyRate": 1}', 'draft', 'old-2', 'awaiting_confirmation', now() - interval '98 days', now() - interval '100 days'),
      ('new-1', '${link.link_id}', 'org-a', 'proj-a', 'u-adm', 'add_roster_entry', '{"dailyRate": 1}', 'draft', 'new-1', 'done', now() + interval '1 day', now() - interval '10 days')`)
    const r = (await one<{ r: J }>(db, "select public.ai_work_link_call_retention() r")).r
    expect(r.keep_days).toBe(90)
    expect(r.intents_deleted).toBe(2)
    expect(Array.isArray(r.created) && Array.isArray(r.dropped)).toBe(true)
    expect(await count(db, "platform.ai_work_link_intent where id in ('old-1', 'old-2')")).toBe(0)
    expect(await count(db, "platform.ai_work_link_intent where id = 'new-1'")).toBe(1)
    // a second run has nothing more to delete
    expect((await one<{ r: J }>(db, "select public.ai_work_link_call_retention() r")).r.intents_deleted).toBe(0)
  })

  test("claimed_at is a nullable timestamptz on the intent table, and the table is still revoked from every role", async () => {
    const c = await one<J>(db, "select data_type, is_nullable from information_schema.columns where table_schema = 'platform' and table_name = 'ai_work_link_intent' and column_name = 'claimed_at'")
    expect(c).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" })
    for (const role of ["anon", "authenticated", "app_runtime", "service_role"]) {
      const g = await one<{ s: boolean }>(db, `select has_table_privilege('${role}', 'platform.ai_work_link_intent', 'SELECT') s`)
      expect({ role, s: g.s }).toEqual({ role, s: false })
    }
  })
})
