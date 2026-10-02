/// <reference types="bun-types" />
// lf-b2-ai-crud GROUP 2 (owner order 2026-10-02): the Edge function's half of "let my AI act without asking". The SQL half (record_intent, the claim,
// the table, the setter) is proven on PGlite in ai-work-link-person-switch.pglite.test.ts; this file runs the REAL handler over the link fake:
//   * the direct path: with the person's switch off a level-2 function is refused on POST /actions (403 LEVEL_NOT_ALLOWED) and /check says it will not
//     run directly; with it on, the same call passes the level gate (503, the executor is not wired here: never 403) and /check says it runs directly;
//     another person's switch does nothing for this link; the kill switch still stops it (403 WRITES_NOT_ENABLED); a level-1 function is unchanged;
//   * the app route GET|POST /settings/act-without-asking: a signed-in person reads and sets THEIR OWN switch, resolved from the session exactly as the
//     confirm route resolves them; a link token is refused (401: an AI cannot switch on its own permission); a bad body is 400; an unlinked person 403;
//     a failing database 503.
// Run: bun test --isolate src/lib/services/ai-work-link-person-switch.test.ts
import { beforeEach, describe, expect, test } from "bun:test"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { resetConfirmLimits } from "../../../supabase/functions/ai-work-link/confirm"
import type { Rpc } from "../../../supabase/functions/ai-work-link/reads"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const LEVEL_2 = { function: "delete_progress_entry", params: { entryId: "e1" } } // lf-b2-ai-crud: a delete, level 2, member rank
const LEVEL_1 = { function: "update_meeting", params: { meetingId: "m1", title: "Moved" } }

function link(opts: { writesEnabled?: boolean; actWithoutAsking?: string[] } = {}) {
  const fake = makeFake({ writesEnabled: opts.writesEnabled ?? true, actWithoutAsking: opts.actWithoutAsking })
  const run = async (token: string, path: string, body: unknown) => {
    const res = await handleAwl(req(`/${token}${path}`, { method: "POST", body }), { rpc: fake.rpc, config: testConfig({ execPresent: true }), log: () => {} })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }
  return { action: (token: string, b: unknown) => run(token, "/actions", b), check: (token: string, b: unknown) => run(token, "/check", b) }
}

describe("the direct path follows the PERSON's switch", () => {
  test("switch off (default): a level-2 function is 403 LEVEL_NOT_ALLOWED on /actions and /check says it will not run directly", async () => {
    const { action, check } = link()
    const direct = await action(TOKENS.manager, LEVEL_2)
    expect(direct).toMatchObject({ status: 403, body: { code: "LEVEL_NOT_ALLOWED" } })
    expect((await check(TOKENS.manager, LEVEL_2)).body).toMatchObject({ valid: true, level: 2, will_execute_directly: false })
  })

  test("switch on: the same call passes the level gate (503 EXECUTOR_NOT_AVAILABLE, never 403) and /check says it runs directly", async () => {
    const { action, check } = link({ actWithoutAsking: ["usr_manager"] })
    const direct = await action(TOKENS.manager, LEVEL_2)
    expect(direct.status).toBe(503)
    expect(direct.body.code).toBe("EXECUTOR_NOT_AVAILABLE")
    expect((await check(TOKENS.manager, LEVEL_2)).body).toMatchObject({ valid: true, level: 2, will_execute_directly: true })
  })

  test("another person's switch does nothing for this link: the member's switch on, the manager's link still refuses", async () => {
    const { action } = link({ actWithoutAsking: ["usr_member"] })
    expect(await action(TOKENS.manager, LEVEL_2)).toMatchObject({ status: 403, body: { code: "LEVEL_NOT_ALLOWED" } })
    expect((await action(TOKENS.member, LEVEL_2)).status).toBe(503)
  })

  test("the kill switch still stops it: writes off, switch on, the change is refused (403 WRITES_NOT_ENABLED) and nothing runs", async () => {
    const { action } = link({ writesEnabled: false, actWithoutAsking: ["usr_manager"] })
    expect(await action(TOKENS.manager, LEVEL_2)).toMatchObject({ status: 403, body: { code: "WRITES_NOT_ENABLED" } })
  })

  test("a link made at level 0 stays drafts-only with the switch on", async () => {
    const { action } = link({ actWithoutAsking: ["usr_manager"] })
    expect(await action(TOKENS.levelZero, LEVEL_2)).toMatchObject({ status: 403, body: { code: "LEVEL_NOT_ALLOWED" } })
  })

  test("a level-1 function is unchanged either way", async () => {
    expect((await link().action(TOKENS.manager, LEVEL_1)).status).toBe(503)
    expect((await link({ actWithoutAsking: ["usr_manager"] }).action(TOKENS.manager, LEVEL_1)).status).toBe(503)
  })
})

// -- the app route ----------------------------------------------------------------------------------------------------------------------------

const SUB = "11111111-1111-4111-8111-111111111111"
const session: SessionVerifier = async (token) =>
  token === "good-session" ? { ok: true, sub: SUB, email: "mira@a.example.test", issuer: "https://example.supabase.co/auth/v1", iat: 1 } : { ok: false, reason: "invalid" }

type Call = { name: string; args: Record<string, unknown> }
function app(o: { person?: Record<string, unknown> | null; failSetting?: boolean } = {}) {
  const calls: Call[] = []
  let stored = false
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args: args as Record<string, unknown> })
    if (name === "projexa_read_resolve_user") return { data: o.person === undefined ? [{ user_id: "u-mgr", reason: null }] : o.person === null ? [] : [o.person], error: null }
    if (o.failSetting) return { data: null, error: { message: "down" } }
    if (name === "ai_work_link_person_setting") return { data: { act_without_asking: stored, updated_at: null, user_id: "u-mgr" }, error: null }
    if (name === "ai_work_link_person_setting_set") {
      stored = (args as { p_act_without_asking: boolean }).p_act_without_asking
      return { data: { act_without_asking: stored, updated_at: "2026-10-02T10:00:00Z" }, error: null }
    }
    return { data: null, error: { message: `unexpected ${name}` } }
  }
  const run = async (method: string, auth: string | null, body?: unknown) => {
    const res = await handleAwl(req("/settings/act-without-asking", { method, body, headers: auth ? { authorization: `Bearer ${auth}` } : {} }), {
      rpc, config: testConfig(), log: () => {}, session, now: () => 1_000_000,
    })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }
  return { run, calls }
}

beforeEach(() => resetConfirmLimits())

describe("GET|POST /settings/act-without-asking: the signed-in person's own switch", () => {
  test("GET reads the switch of the person the session names (resolved by projexa_read_resolve_user), and only the two fields", async () => {
    const { run, calls } = app()
    const res = await run("GET", "good-session")
    expect(res).toEqual({ status: 200, body: { act_without_asking: false, updated_at: null } })
    expect(calls.map((c) => c.name)).toEqual(["projexa_read_resolve_user", "ai_work_link_person_setting"])
    expect(calls[1].args).toEqual({ p_user_id: "u-mgr" })
  })

  test("POST sets it for that person only; the next GET reads it back", async () => {
    const { run, calls } = app()
    expect(await run("POST", "good-session", { act_without_asking: true })).toEqual({ status: 200, body: { act_without_asking: true, updated_at: "2026-10-02T10:00:00Z" } })
    expect(calls.find((c) => c.name === "ai_work_link_person_setting_set")!.args).toEqual({ p_user_id: "u-mgr", p_act_without_asking: true })
    expect((await run("GET", "good-session")).body.act_without_asking).toBe(true)
  })

  test("a link token is never a session (401), and neither is no token or a bad one; nothing is read or set", async () => {
    const { run, calls } = app()
    expect((await run("POST", TOKENS.manager, { act_without_asking: true })).status).toBe(401)
    expect((await run("POST", null, { act_without_asking: true })).status).toBe(401)
    expect((await run("GET", "bad-session")).status).toBe(401)
    expect(calls).toEqual([])
  })

  test("a body that is not {act_without_asking: boolean} is 400 BAD_VALUE and nothing is set", async () => {
    const { run, calls } = app()
    for (const body of [{ act_without_asking: "yes" }, {}, [], "true"]) {
      expect({ body, status: (await run("POST", "good-session", body)).status }).toEqual({ body, status: 400 })
    }
    expect(calls.some((c) => c.name === "ai_work_link_person_setting_set")).toBe(false)
  })

  test("a person not linked to one PROJEXA user is 403 USER_NOT_LINKED; a failing database is 503 and reports nothing as set", async () => {
    const notLinked = app({ person: { user_id: null, reason: "not_linked" } })
    expect(await notLinked.run("POST", "good-session", { act_without_asking: true })).toMatchObject({ status: 403, body: { code: "USER_NOT_LINKED" } })
    const down = app({ failSetting: true })
    expect(await down.run("POST", "good-session", { act_without_asking: true })).toMatchObject({ status: 503, body: { code: "SETTING_UNAVAILABLE" } })
  })

  test("other methods are 405", async () => {
    const { run } = app()
    expect((await run("DELETE", "good-session")).status).toBe(405)
  })
})
