/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-15 (register row AW-902, BR-509): the wiring that switches the extraction model on (supabase/functions/projexa-document-extract/wiring.ts):
// the Groq call and the ledger over the three SQL functions of drizzle/0652. The real handler and the real budget code run in process; the network is a
// fake fetch and the database is an in-memory stand-in of the three functions. Nothing reaches a provider or a database.
//
// WHAT IS PROVEN
//   1. the model call: Groq's endpoint, the model of the price table, temperature 0, a JSON object answer, the key only in the Authorization header (never in the
//      body), the caller's abort signal, the provider's token counts; a refused call, a call with no content and a call with no counts are each handled (throw / throw /
//      no usage, so the reservation estimate stands);
//   2. the ledger: each of the three methods calls its SQL function with the right arguments, and an error, an empty id or a total that is not a number throws (the
//      budget then fails closed);
//   3. end to end through the handler: an allowed call writes ONE ledger row that is settled with the provider's token counts (cost from the price table), and once the
//      recorded spend has reached the cap the next call is 402 budget_exhausted with the fake provider never called.
//
// Run: bun test --isolate src/lib/services/projexa-document-extract-wiring.test.ts
import { describe, expect, test } from "bun:test"
import { handleProjexaDocumentExtract, type ExtractDeps } from "../../../supabase/functions/projexa-document-extract/handler"
import { BUDGET_FEATURE_KEY, DEFAULT_PRICE_TABLE, attributionFromHeaders, parseCapUsd } from "../../../supabase/functions/projexa-document-extract/budget"
import { GROQ_MODEL, GROQ_PROVIDER, GROQ_URL, ModelCallError, OPENROUTER_PROVIDER, OPENROUTER_URL, completionTokensFor, groqModel, ledgerOver, openRouterModel, type Rpc } from "../../../supabase/functions/projexa-document-extract/wiring"
import { SHARED_SECRET } from "./__test-helpers__/document-extraction-fixtures"

const KEY = "gsk_test_key_not_real_0123456789"
const goodBody = JSON.stringify({ schema: "boq_project_v1", fileName: "villa.xlsx", sheets: [{ name: "Civil", rows: [{ row: 4, cells: ["1.01", "Excavation", "m3", "100", "250"] }] }] })

type Call = { url: string; init: RequestInit }
function fakeGroq(reply: unknown, status = 200) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(reply), { status })
  }
  return { calls, fetchImpl }
}
const answer = (content: unknown, usage?: unknown) => ({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })
const request = { system: "SYSTEM", user: "USER", maxOutputChars: 80_000 }

describe("groqModel", () => {
  test("posts to Groq with the model, temperature 0 and a JSON answer; the key is only in the Authorization header; the provider's token counts come back", async () => {
    const g = fakeGroq(answer('{"ok":true}', { prompt_tokens: 1200, completion_tokens: 300 }))
    const controller = new AbortController()
    const reply = await groqModel(KEY, g.fetchImpl)({ ...request, signal: controller.signal })
    expect(reply).toEqual({ text: '{"ok":true}', usage: { promptTokens: 1200, completionTokens: 300 } })
    expect(g.calls).toHaveLength(1)
    expect(g.calls[0].url).toBe(GROQ_URL)
    const headers = g.calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(g.calls[0].init.body))
    expect(body).toMatchObject({ model: GROQ_MODEL, temperature: 0, response_format: { type: "json_object" }, max_tokens: completionTokensFor(80_000), reasoning_effort: "medium" })
    expect(body.messages).toEqual([{ role: "system", content: "SYSTEM" }, { role: "user", content: "USER" }])
    expect(String(g.calls[0].init.body)).not.toContain(KEY)
    expect(g.calls[0].init.signal).toBe(controller.signal)
  })

  test("OpenRouter: its own endpoint, the same model, the JSON mode kept (require_parameters) and medium reasoning; the key only in the header; the counts come back", async () => {
    const g = fakeGroq(answer('{"ok":true}', { prompt_tokens: 40_000, completion_tokens: 900 }))
    const reply = await openRouterModel(KEY, g.fetchImpl)(request)
    expect(reply).toEqual({ text: '{"ok":true}', usage: { promptTokens: 40_000, completionTokens: 900 } })
    expect(g.calls[0].url).toBe(OPENROUTER_URL)
    expect((g.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(g.calls[0].init.body))
    expect(body).toMatchObject({ model: GROQ_MODEL, temperature: 0, response_format: { type: "json_object" }, reasoning: { effort: "medium" }, provider: { require_parameters: true, sort: "throughput" }, max_tokens: completionTokensFor(80_000) })
    expect(String(g.calls[0].init.body)).not.toContain(KEY)
    expect(OPENROUTER_PROVIDER).toBe("openrouter")
    await expect(openRouterModel(KEY, fakeGroq({}, 402).fetchImpl)(request)).rejects.toMatchObject({ name: "ModelCallError", status: 402 })
  })

  test("the model is the one with a price row, and the completion budget is bounded by Groq's own ceiling", () => {
    expect(Object.keys(DEFAULT_PRICE_TABLE)).toContain(GROQ_MODEL)
    expect(GROQ_PROVIDER).toBe("groq")
    expect(completionTokensFor(80_000)).toBe(48_000)
    expect(completionTokensFor(10_000_000)).toBe(65_536)
  })

  test("a refused call throws with its status (never the body), an answer with no content throws, and an answer with no counts carries no usage", async () => {
    await expect(groqModel(KEY, fakeGroq({ error: { message: "bad key gsk_x" } }, 401).fetchImpl)(request)).rejects.toMatchObject({ name: "ModelCallError", status: 401 })
    const err = await groqModel(KEY, fakeGroq({ error: { message: "secret detail" } }, 429).fetchImpl)(request).catch((e: Error) => e)
    expect(err).toBeInstanceOf(ModelCallError)
    expect((err as Error).message).not.toContain("secret detail")
    await expect(groqModel(KEY, fakeGroq(answer(""), 200).fetchImpl)(request)).rejects.toMatchObject({ status: 502 })
    await expect(groqModel(KEY, fakeGroq({ choices: [] }, 200).fetchImpl)(request)).rejects.toMatchObject({ status: 502 })
    expect(await groqModel(KEY, fakeGroq(answer("{}")).fetchImpl)(request)).toEqual({ text: "{}" })
    expect(await groqModel(KEY, fakeGroq(answer("{}", { prompt_tokens: "x", completion_tokens: 1 })).fetchImpl)(request)).toEqual({ text: "{}" })
  })
})

/** An in-memory stand-in of the three SQL functions of drizzle/0652. */
function memoryRpc() {
  const rows: Array<{ id: string; org: string; user: string; task: string; feature: string; provider: string; model: string; prompt: number; completion: number; cost: number; success: boolean; failure: string | null }> = []
  const calls: string[] = []
  const rpc: Rpc = async (fn, args) => {
    calls.push(fn)
    if (fn === "projexa_extract_ledger_total") return { data: rows.filter((r) => r.feature === args.p_feature).reduce((sum, r) => sum + r.cost, 0), error: null }
    if (fn === "projexa_extract_ledger_reserve") {
      const id = `row-${rows.length + 1}`
      rows.push({ id, org: String(args.p_org_id), user: String(args.p_user_id), task: String(args.p_task_id), feature: String(args.p_feature), provider: String(args.p_provider), model: String(args.p_model), prompt: Number(args.p_prompt_tokens), completion: Number(args.p_completion_tokens), cost: Number(args.p_estimated_cost_usd), success: true, failure: null })
      return { data: id, error: null }
    }
    if (fn === "projexa_extract_ledger_settle") {
      const row = rows.find((r) => r.id === args.p_id)
      if (row) Object.assign(row, { prompt: Number(args.p_prompt_tokens), completion: Number(args.p_completion_tokens), cost: Number(args.p_estimated_cost_usd), success: Boolean(args.p_success), failure: (args.p_failure_reason as string | null) ?? null })
      return { data: null, error: null }
    }
    return { data: null, error: { message: "unknown function" } }
  }
  return { rows, calls, rpc }
}

describe("ledgerOver", () => {
  test("each method calls its SQL function with the right arguments", async () => {
    const m = memoryRpc()
    const ledger = ledgerOver(m.rpc)
    expect(await ledger.readRecordedTotalUsd(BUDGET_FEATURE_KEY)).toBe(0)
    const id = await ledger.insertReservation({ orgId: "o1", userId: "u1", requestId: "r1", feature: BUDGET_FEATURE_KEY, provider: "groq", model: GROQ_MODEL, promptTokens: 10, completionTokens: 20, estimatedCostUsd: 0.5 })
    expect(m.rows[0]).toMatchObject({ id, org: "o1", user: "u1", task: "r1", feature: BUDGET_FEATURE_KEY, provider: "groq", model: GROQ_MODEL, prompt: 10, completion: 20, cost: 0.5 })
    await ledger.finalizeReservation(id, { promptTokens: 7, completionTokens: 9, estimatedCostUsd: 0.25, success: false, failureReason: "model_failed", usageSource: "provider" })
    expect(m.rows[0]).toMatchObject({ prompt: 7, completion: 9, cost: 0.25, success: false, failure: "model_failed" })
    expect(await ledger.readRecordedTotalUsd(BUDGET_FEATURE_KEY)).toBe(0.25)
    expect(m.calls).toEqual(["projexa_extract_ledger_total", "projexa_extract_ledger_reserve", "projexa_extract_ledger_settle", "projexa_extract_ledger_total"])
  })

  test("an error, an empty id or a total that is not a number throws, so the budget fails closed", async () => {
    const fail = ledgerOver(async () => ({ data: null, error: { message: "boom" } }))
    await expect(fail.readRecordedTotalUsd("f")).rejects.toThrow()
    await expect(fail.insertReservation({ orgId: "o", userId: "u", requestId: "r", feature: "f", provider: "p", model: "m", promptTokens: 1, completionTokens: 1, estimatedCostUsd: 1 })).rejects.toThrow()
    await expect(fail.finalizeReservation("id", { promptTokens: 1, completionTokens: 1, estimatedCostUsd: 1, success: true, failureReason: null, usageSource: "provider" })).rejects.toThrow()
    await expect(ledgerOver(async () => ({ data: "", error: null })).insertReservation({ orgId: "o", userId: "u", requestId: "r", feature: "f", provider: "p", model: "m", promptTokens: 1, completionTokens: 1, estimatedCostUsd: 1 })).rejects.toThrow()
    await expect(ledgerOver(async () => ({ data: "abc", error: null })).readRecordedTotalUsd("f")).rejects.toThrow()
    await expect(ledgerOver(async () => ({ data: -1, error: null })).readRecordedTotalUsd("f")).rejects.toThrow()
  })
})

describe("through the real handler", () => {
  function setup(capUsd: number, reply: unknown) {
    const g = fakeGroq(reply)
    const m = memoryRpc()
    const deps: ExtractDeps = {
      verifyCaller: async () => true,
      model: groqModel(KEY, g.fetchImpl),
      budget: {
        ledger: ledgerOver(m.rpc),
        provider: GROQ_PROVIDER,
        model: GROQ_MODEL,
        capUsd: parseCapUsd(String(capUsd)),
        resolveAttribution: (r: Request) => attributionFromHeaders(r.headers, () => "generated-id"),
      },
    }
    const post = () =>
      handleProjexaDocumentExtract(
        new Request("https://edge.test/functions/v1/projexa-document-extract", {
          method: "POST",
          headers: { authorization: `Bearer ${SHARED_SECRET}`, "content-type": "application/json", "x-projexa-org-id": "org-1", "x-projexa-user-id": "user-1", "x-projexa-request-id": "req-1" },
          body: goodBody,
        }),
        deps,
      )
    return { g, m, post }
  }

  test("an allowed call writes ONE ledger row, settled with the provider's token counts and the price table's cost", async () => {
    const { g, m, post } = setup(1, answer(JSON.stringify({ schema: "boq_project_v1" }), { prompt_tokens: 2000, completion_tokens: 1000 }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(g.calls).toHaveLength(1)
    expect(m.rows).toHaveLength(1)
    const price = DEFAULT_PRICE_TABLE[GROQ_MODEL]
    expect(m.rows[0]).toMatchObject({ org: "org-1", user: "user-1", task: "req-1", feature: BUDGET_FEATURE_KEY, provider: GROQ_PROVIDER, model: GROQ_MODEL, prompt: 2000, completion: 1000, success: true })
    expect(m.rows[0].cost).toBeCloseTo((2000 / 1000) * price.promptPer1k + (1000 / 1000) * price.completionPer1k, 8)
  })

  test("once the recorded spend has reached the cap the next call is 402 budget_exhausted and Groq is never called", async () => {
    const { g, m, post } = setup(0.0005, answer(JSON.stringify({ schema: "boq_project_v1" }), { prompt_tokens: 1000, completion_tokens: 1000 }))
    m.rows.push({ id: "earlier", org: "o", user: "u", task: "t", feature: BUDGET_FEATURE_KEY, provider: "groq", model: GROQ_MODEL, prompt: 0, completion: 0, cost: 0.0005, success: true, failure: null })
    const res = await post()
    expect(res.status).toBe(402)
    expect(((await res.json()) as { code: string }).code).toBe("budget_exhausted")
    expect(g.calls).toHaveLength(0)
    expect(m.rows).toHaveLength(1)
  })
})
