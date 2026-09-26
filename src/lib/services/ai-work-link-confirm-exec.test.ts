/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register rows AW-505, AW-508 second half; spec 9.5, 9.6): the confirm route hands a CONFIRMED draft to the exec function and tells
// the person what happened, and a draft confirmed while the executor was down is driven again by the same confirm link, once.
//
// Real: handleConfirm (confirm.ts), the real SQL (drizzle/0621 to 0630 on PGlite: record_intent, draft_confirm, draft_state, claim, finish), the REAL exec
// handler (handleExec). Faked: the session verifier (an accepted person), and the pipeline run of the exec handler (a stub that answers what
// link-exec-entry would; the pipeline itself is proven in ai-work-link-exec.test.ts).
//
// WHAT IS PROVEN
//   applied        confirm -> exec -> 200 {status: "done", record}; the intent reads done; the person is told it was applied
//   not applied    the exec function unreachable: 200 {status: "confirmed"} with "not applied yet"; the intent stays confirmed; the SAME link again claims
//                  and runs it ONCE (the code is single use, the draft is not); a third call is 409 (already applied)
//   failed         a failed run: 200 {status: "failed", code, missing}; the intent reads failed
//   refused        a person demoted after confirming: 200 {status: "refused", code: ROLE_CHANGED}; nothing runs
//   no exec        without an exec client the answer is the queued sentence of before and the draft stays confirmed
//   others         another person's confirm never reaches the exec function; a wrong code never does; writes off answers 503 and never does
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. confirm.ts: skip the exec call after "confirmed"                                   -> "confirm hands the draft to the exec function ..." fails
//   2. confirm.ts redrive: do not check the draft's state (drive any not_pending draft)    -> "a done draft is not driven again" fails
//   3. confirm.ts redrive: drop the draft_state check (call exec directly, whatever the draft is) -> "a done draft is not driven again" fails
//      (owner and code are checked earlier still, by draft_confirm, so "another person ..." holds either way: that is why the break named here is the state check)
//
// Run: bun test --isolate src/lib/services/ai-work-link-confirm-exec.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleConfirm, resetConfirmLimits, type ConfirmDeps } from "../../../supabase/functions/ai-work-link/confirm"
import { handleExec, type ExecDeps, type Ran } from "../../../supabase/functions/ai-work-link-exec/handler"
import { makeExecClient } from "../../../supabase/functions/ai-work-link/exec-client"
import type { ExecClient } from "../../../supabase/functions/ai-work-link/reads"
import { forwardSql } from "./__test-helpers__/awl-pglite"
import { AUTH, intentRow, mintLink, openWriteDb, recordIntent, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(60_000)

const SECRET = "test-secret-value-of-some-length"
const WORK = { itemCode: "EX-01", percent: 10 }
let db: PGlite
let n = 0
const key = () => `cx-${++n}`
let runs: string[] = []
let ranAs: Ran = { status: "done", submission_id: "sub-1", record: { id: "rec-1", route: "/progress/rec-1" } }

beforeAll(async () => {
  db = await openWriteDb()
  // public.projexa_read_resolve_user: who the signed-in person is
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
}, 120_000)
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  resetConfirmLimits()
  runs = []
  ranAs = { status: "done", submission_id: "sub-1", record: { id: "rec-1", route: "/progress/rec-1" } }
  await setWrites(db, true)
  await db.exec("update compliance.users set role = 'manager' where id = 'u-mgr'")
})

/** The REAL exec handler over the REAL SQL, called the way the link function calls it (an ExecClient over a fake fetch). */
function realExec(over: { down?: boolean } = {}): ExecClient {
  const deps: ExecDeps = {
    rpc: rpcFor(db),
    secret: SECRET,
    dbConfigured: true,
    run: async (c) => {
      runs.push(c.intent.id)
      return ranAs
    },
    health: async () => ({ db_role: "app_runtime" }),
    log: () => {},
  }
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (over.down) throw new Error("connection reset")
    return handleExec(new Request(String(url), init), deps)
  }) as typeof fetch
  return makeExecClient({ baseUrl: "https://x.supabase.co/functions/v1/ai-work-link-exec", secret: SECRET, fetchFn })
}

const session = (sub: string) => async () => ({ ok: true as const, sub, email: null, issuer: "test", iat: null })
const confirmReq = (draftId: string, code: string) => new Request(`https://x.supabase.co/functions/v1/ai-work-link/drafts/${draftId}/confirm`, { method: "POST", headers: { authorization: "Bearer session-token", "content-type": "application/json" }, body: JSON.stringify({ confirmToken: code }) })

function confirmDeps(over: Partial<ConfirmDeps> = {}, as: string = AUTH.mgr): ConfirmDeps {
  return { rpc: rpcFor(db), session: session(as), log: () => {}, now: () => Date.now(), ...over }
}

async function draft(fn = "record_work_progress", params: Record<string, unknown> = WORK): Promise<J> {
  const link = await mintLink(db, "u-mgr", "proj-a", { level: 1 })
  return recordIntent(db, link.token, "draft", fn, params, key())
}

describe("confirm hands a confirmed draft to the exec function", () => {
  test("confirm hands the draft to the exec function, which runs it once: 200 done with the record, the intent reads done", async () => {
    const d = await draft()
    const r = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ draft_id: d.intent_id, status: "done", function_id: "record_work_progress", record: { id: "rec-1", route: "/progress/rec-1" }, submission_id: "sub-1" })
    expect(runs).toEqual([d.intent_id])
    expect(await intentRow(db, d.intent_id)).toMatchObject({ status: "done", submission_id: "sub-1", result: { id: "rec-1", route: "/progress/rec-1" } })
    // the answer never carries the code or the parameters
    expect(JSON.stringify(r.body)).not.toContain(d.confirm_token)
  })

  test("a done draft is not driven again: the same code is 409 CONFIRM_ALREADY_USED and nothing runs twice", async () => {
    const d = await draft()
    const deps = confirmDeps({ exec: realExec() })
    await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, deps)
    const again = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, deps)
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: "CONFIRM_ALREADY_USED" })
    expect(runs).toEqual([d.intent_id])
  })

  test("the executor down at confirm: 200 confirmed 'not applied yet', the intent stays confirmed; the SAME link again runs it ONCE; a third call is 409", async () => {
    const d = await draft()
    const down = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec({ down: true }) }))
    expect(down.status).toBe(200)
    expect(down.body).toMatchObject({ status: "confirmed" })
    expect(String((down.body as J).message)).toContain("not applied yet")
    expect((await intentRow(db, d.intent_id)).status).toBe("confirmed")
    expect(runs).toEqual([])

    const again = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ status: "done", record: { id: "rec-1" } })
    expect(runs).toEqual([d.intent_id])

    const third = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(third.status).toBe(409)
    expect(runs).toEqual([d.intent_id])
  })

  test("a failed run: 200 failed with its code and what is missing; the intent reads failed", async () => {
    ranAs = { status: "failed", code: "BOQ_LINE_NOT_FOUND", missing: ["boqLine"], submission_id: "sub-2" }
    const d = await draft()
    const r = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: "failed", code: "BOQ_LINE_NOT_FOUND", missing: ["boqLine"] })
    expect(await intentRow(db, d.intent_id)).toMatchObject({ status: "failed", failure: { code: "BOQ_LINE_NOT_FOUND", missing: ["boqLine"] } })
  })

  test("a person demoted after the draft was made: confirm is 200 refused ROLE_CHANGED and nothing runs", async () => {
    const d = await draft()
    await db.exec("update compliance.users set role = 'viewer' where id = 'u-mgr'")
    const r = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    // record_intent needs rank 2 and a viewer has none, so the draft is confirmed by SQL and then refused at the claim
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: "refused", code: "ROLE_CHANGED" })
    expect(runs).toEqual([])
    expect(await intentRow(db, d.intent_id)).toMatchObject({ status: "refused", failure: { code: "ROLE_CHANGED" } })
  })

  test("without an exec client the answer is the queued sentence and the draft stays confirmed (unchanged behaviour)", async () => {
    const d = await draft()
    const r = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: "confirmed", message: "Confirmed. The change is queued for the executor." })
    expect((await intentRow(db, d.intent_id)).status).toBe("confirmed")
  })
})

describe("who reaches the exec function", () => {
  test("another person's confirm and a wrong code never reach exec (403 and 409), while the draft stays awaiting; writes off is 503 and does not reach it either", async () => {
    const d = await draft()
    const other = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }, AUTH.mem))
    expect(other.status).toBe(403)
    const wrong = await handleConfirm(confirmReq(d.intent_id, "0".repeat(64)), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(wrong.status).toBe(409)
    expect((await intentRow(db, d.intent_id)).status).toBe("awaiting_confirmation")

    await setWrites(db, false)
    const off = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(off.status).toBe(503)
    expect(runs).toEqual([])
    expect((await intentRow(db, d.intent_id)).status).toBe("awaiting_confirmation")
  })

  test("a confirmed draft cannot be driven by another person or with a wrong code, even though the exec function is up", async () => {
    const d = await draft()
    await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec({ down: true }) }))
    expect((await intentRow(db, d.intent_id)).status).toBe("confirmed")

    const other = await handleConfirm(confirmReq(d.intent_id, d.confirm_token), d.intent_id, confirmDeps({ exec: realExec() }, AUTH.mem))
    expect(other.status).toBe(403)
    const wrong = await handleConfirm(confirmReq(d.intent_id, "1".repeat(64)), d.intent_id, confirmDeps({ exec: realExec() }))
    expect(wrong.status).toBe(409)
    expect(runs).toEqual([])
    expect((await intentRow(db, d.intent_id)).status).toBe("confirmed")
  })
})
