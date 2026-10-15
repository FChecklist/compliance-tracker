/// <reference types="bun-types" />
// AUDIT-37 guide speed: GET the personal guide must be fast and robust even when the database is slow. The REAL handler runs against the fake
// database (__test-helpers__/awl-edge-fake.ts). Proves: (1) a guide GET makes exactly 3 database calls, 2 of them before the answer;
// (2) the call-result write never delays or fails the answer; (3) a slow or dead link read is a clear 503 inside the time box, never a hang;
// (4) a slow call result still lets the guide (200) through. Run: bun test --isolate src/lib/services/ai-work-link-guide-speed.test.ts
import { describe, test, expect } from "bun:test"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import type { Rpc } from "../../../supabase/functions/ai-work-link/handler"
import { TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function wrap(slow: Record<string, number>, hang: string[] = []) {
  const fake = makeFake({})
  const seen: string[] = []
  const rpc: Rpc = async (name, args) => {
    seen.push(name)
    if (hang.includes(name)) return await new Promise<never>(() => {})
    if (slow[name]) await sleep(slow[name])
    return fake.rpc(name, args)
  }
  return { seen, rpc }
}
const get = (rpc: Rpc, extra: Record<string, unknown> = {}) =>
  handleAwl(req(`/${TOKENS.manager}`), { rpc, config: testConfig(), log: () => undefined, ...extra })

describe("guide GET speed", () => {
  test("makes at most 3 database calls: log, resolve, result", async () => {
    const w = wrap({})
    const res = await get(w.rpc)
    expect(res.status).toBe(200)
    expect((await res.text()).length).toBeGreaterThan(1000)
    expect(w.seen).toEqual(["ai_work_link_log_call", "ai_work_link__resolve", "ai_work_link_log_call_result"])
  })

  test("a slow call-result write does not delay the answer", async () => {
    const w = wrap({ ai_work_link_log_call_result: 1500 })
    const t0 = Date.now()
    const res = await get(w.rpc)
    expect(res.status).toBe(200)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  test("a failing call-result write does not fail the answer", async () => {
    const w = wrap({})
    const rpc: Rpc = async (n, a) => { if (n === "ai_work_link_log_call_result") throw new Error("down"); return w.rpc(n, a) }
    expect((await get(rpc)).status).toBe(200)
  })

  test("defer receives the background write", async () => {
    const w = wrap({})
    const deferred: Promise<unknown>[] = []
    await get(w.rpc, { defer: (p: Promise<unknown>) => deferred.push(p) })
    expect(deferred.length).toBe(1)
    await Promise.all(deferred)
  })

  test("a link read that never answers is a clear 503 inside the time box", async () => {
    const w = wrap({}, ["ai_work_link__resolve"])
    const t0 = Date.now()
    const res = await get(w.rpc, { dbTimeoutMs: 100 })
    expect(res.status).toBe(503)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(await res.text()).toContain("Try again in a minute")
  })

  test("a call log that never answers is a clear 503 and reads nothing", async () => {
    const w = wrap({}, ["ai_work_link_log_call"])
    const res = await get(w.rpc, { dbTimeoutMs: 100 })
    expect(res.status).toBe(503)
    expect(w.seen).toEqual(["ai_work_link_log_call"])
  })

  test("a call result that never answers still returns the guide", async () => {
    const w = wrap({}, ["ai_work_link_log_call_result"])
    const res = await get(w.rpc, { dbTimeoutMs: 100 })
    expect(res.status).toBe(200)
  })
})
