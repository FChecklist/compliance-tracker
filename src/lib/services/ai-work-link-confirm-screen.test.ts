/// <reference types="bun-types" />
// AUDIT-100 items 4, 5 and 6 on the function side:
//   4  POST /check answers in plain words: who the person is (name and organisation), whether the change deletes or touches money (the extra tick), and the real
//      name of the record an id parameter points at, read live; a forged id is "not found" and targets_ok is false. riskOf is the one rule the screens and the
//      confirm route share.
//   5  the receipt: R-XXXXX from the intent id, in the answer of a draft, and in the workspace's "Recent changes by you via AI".
//   6  every address printed uses the host form the person typed, but only a host the deployment lists (AWL_ALT_HOSTS); a forged Host changes nothing.
// Run: bun test --isolate src/lib/services/ai-work-link-confirm-screen.test.ts
import { describe, test, expect } from "bun:test"
import { handleAwl, type Rpc } from "../../../supabase/functions/ai-work-link/handler"
import { configForRequest, configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { DELETE_ID_RE, plainSentence, receiptOf, riskOf, tickTextOf } from "../../../supabase/functions/ai-work-link/risk"
import { TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const NOW = () => Date.parse("2026-10-06T02:47:04Z")
function setup(wrap?: (rpc: Rpc) => Rpc, config = testConfig()) {
  const fake = makeFake({})
  const rpc = wrap ? wrap(fake.rpc) : fake.rpc
  const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc, config, log: () => {}, now: NOW })
  return { fake, run }
}
const withCard = (rpc: Rpc): Rpc => async (fn, args) => (fn === "ai_work_link_person_card" ? { data: { name: "Asha Rao", organisation: "Rao Builders" }, error: null } : rpc(fn, args))
const post = (fn: string, params: Record<string, unknown>) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ function: fn, params }) }) as Parameters<typeof req>[1]

describe("risk: one rule for the screens and the confirm route", () => {
  test("deletes, cancels, retires and rejects need the tick; so does anything the registry marks money-sensitive; a plain add or edit does not", () => {
    for (const id of ["delete_boq", "archive_task", "remove_room", "void_material_receipt", "cancel_change_order", "reject_timesheet"]) expect(`${id} ${riskOf(id).needs_tick}`).toBe(`${id} true`)
    expect(riskOf("delete_meeting")).toEqual({ delete: true, money: false, needs_tick: true })
    expect(riskOf("add_boq_lines")).toEqual({ delete: false, money: true, needs_tick: true })
    expect(riskOf("record_work_progress").needs_tick).toBe(false)
    expect(riskOf("not_a_function").needs_tick).toBe(false)
    expect(DELETE_ID_RE.test("create_project")).toBe(false)
    expect(tickTextOf(riskOf("delete_meeting"))).toContain("deletes or cancels")
    expect(tickTextOf(riskOf("add_boq_lines"))).toContain("money")
    expect(plainSentence("delete_meeting")).toContain("deletes or cancels")
  })
  test("a receipt is R- and 5 characters, the same for the same id, different for different ids", () => {
    expect(receiptOf("int_1")).toMatch(/^R-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    expect(receiptOf("int_1")).toBe(receiptOf("int_1"))
    expect(new Set(Array.from({ length: 200 }, (_, i) => receiptOf(`intent-${i}`))).size).toBeGreaterThan(190)
  })
})

describe("POST /check in plain words", () => {
  test("name and organisation, the plain sentence, no tick for a plain change", async () => {
    const { run } = setup(withCard)
    const r = await run(`/${TOKENS.manager}/check`, post("record_work_progress", { itemCode: "EX-01", percent: 40 }))
    const j = (await r.json()) as Record<string, any>
    expect(r.status).toBe(200)
    expect(j.acting_for).toEqual({ name: "Asha Rao", organisation: "Rao Builders" })
    expect(j.risk.needs_tick).toBe(false)
    expect(typeof j.plain).toBe("string")
    expect(j.targets_ok).toBe(true)
  })

  test("a delete: the tick is demanded, and the record's real name is read live; a forged id is not found and targets_ok is false", async () => {
    const { run, fake } = setup(withCard)
    const list = (await (await run(`/${TOKENS.manager}/records/tasks?format=json`)).json()) as { items: Array<Record<string, unknown>> }
    const real = list.items[0]
    const ok = (await (await run(`/${TOKENS.manager}/check`, post("archive_task", { issueId: String(real.id) }))).json()) as Record<string, any>
    expect(ok.risk).toMatchObject({ delete: true, needs_tick: true })
    expect(ok.risk.tick_text).toContain("deletes or cancels")
    expect(ok.targets).toHaveLength(1)
    expect(ok.targets[0]).toMatchObject({ param: "issueId", kind: "tasks", id: String(real.id), found: true })
    expect(ok.targets_ok).toBe(true)
    const forged = (await (await run(`/${TOKENS.manager}/check`, post("archive_task", { issueId: "someone-elses-task" }))).json()) as Record<string, any>
    expect(forged.targets[0]).toMatchObject({ found: false, name: null })
    expect(forged.targets_ok).toBe(false)
    expect(fake.calls.some((c) => c.name === "ai_work_link_record")).toBe(true)
  })

  test("a record that cannot be read just now is neither found nor not found, and when the person card cannot be read the link's own name is shown", async () => {
    const { run } = setup((rpc) => async (fn, args) => (fn === "ai_work_link_record" ? { data: null, error: { message: "boom", code: "XX000" } } : rpc(fn, args)))
    const j = (await (await run(`/${TOKENS.manager}/check`, post("archive_task", { issueId: "t1" }))).json()) as Record<string, any>
    expect(j.targets[0].found).toBe(null)
    expect(j.targets_ok).toBe(false)
    expect(typeof j.acting_for.name).toBe("string")
    expect(j.acting_for.organisation).toBe(null)
  })
})

describe("the receipt", () => {
  test("a draft's answer carries its receipt, and the workspace lists recent changes with the same receipt", async () => {
    const { run } = setup(withCard)
    const draft = await run(`/${TOKENS.manager}/drafts`, post("create_meeting", { title: "Kick-off" }))
    const dj = (await draft.json()) as Record<string, any>
    if (draft.status === 201 || draft.status === 200) expect(dj.receipt).toBe(receiptOf(dj.draft_id))
    const ws = await (await run(`/${TOKENS.manager}/workspace`)).text()
    expect(ws).toContain("## Recent changes by you via AI")
    expect(ws).toContain(receiptOf("int_1"))
    expect(ws.indexOf("## Recent changes by you via AI")).toBeLessThan(ws.indexOf("## What I can do for you"))
  })
})

describe("the Claude.ai connector how-to (item 8)", () => {
  test("the workspace of a link carries the three steps with the link's own address, and header mode (no token in the address) carries none", async () => {
    const { run } = setup(withCard)
    const ws = await (await run(`/${TOKENS.userManager}/workspace`)).text()
    expect(ws).toContain("## Add this link to Claude.ai as a connector")
    expect(ws).toContain("Settings, then Connectors, then Add custom connector")
    expect(ws).toContain(`Address (the whole line): ${new URL(testConfig().functionBase).origin}/functions/v1/ai-work-link/${TOKENS.userManager}`)
    const header = await (await run(`/header/workspace`, { headers: { "link-token": TOKENS.userManager } })).text()
    expect(header).not.toContain("## Add this link to Claude.ai")
  })
})

describe("addresses follow the host form the person typed (item 6)", () => {
  const alt = "alt-host.example.test"
  test("a listed host is used for every printed address; an unlisted or forged host keeps the fixed base; the path part never changes", async () => {
    const config = { ...testConfig(), altHosts: [alt] }
    const base = new URL(config.functionBase).host
    expect(configForRequest(config, alt).functionBase).toBe(`https://${alt}/functions/v1/ai-work-link`)
    expect(configForRequest(config, "ALT-HOST.example.test").functionBase).toBe(`https://${alt}/functions/v1/ai-work-link`)
    expect(configForRequest(config, "evil.example.test").functionBase).toBe(config.functionBase)
    expect(configForRequest(config, base).functionBase).toBe(config.functionBase)
    expect(configForRequest(config, "bad host/x").functionBase).toBe(config.functionBase)
    expect(configForRequest({ ...config, altHosts: [] }, alt).functionBase).toBe(config.functionBase)
    const fake = makeFake({})
    const get = async (host: string) => (await handleAwl(new Request(`https://${host}/functions/v1/ai-work-link/${TOKENS.userManager}/workspace`), { rpc: fake.rpc, config, log: () => {}, now: NOW })).text()
    const typed = await get(alt)
    expect(typed).toContain(`https://${alt}/functions/v1/ai-work-link/${TOKENS.userManager}`)
    expect(typed).not.toContain(base)
    const normal = await get(base)
    expect(normal).not.toContain(alt)
    const forged = await get("evil.example.test")
    expect(forged).not.toContain("evil.example.test")
  })
  test("AWL_ALT_HOSTS: only well-formed hosts are kept, none by default", () => {
    expect(configFromEnv(() => undefined).altHosts).toEqual([])
    expect(configFromEnv((n) => (n === "AWL_ALT_HOSTS" ? "A.example.test, bad host, x/y ,b.example.test" : undefined)).altHosts).toEqual(["a.example.test", "b.example.test"])
  })
})
