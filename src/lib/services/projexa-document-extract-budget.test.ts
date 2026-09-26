/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-36b (register row BR-526, PMD-43, PMD-40): the spend cap of the projexa-document-extract Edge Function.
// The real handler and the real budget code (supabase/functions/projexa-document-extract/handler.ts and budget.ts) run in process
// with an in-memory usage ledger (__test-helpers__/extract-budget-fixtures.ts) and a model the test writes. No network, no database,
// no provider. Proofs:
//   1. THE RULE (decideBudget): under the cap allows; at the cap refuses; a call that would cross the cap refuses; a call that lands
//      exactly on the cap is allowed; a bad figure refuses; the cap is configuration with a default of 1.00 USD.
//   2. METERING: an allowed call writes exactly one ledger row with organisation, user, model, tokens, cost and request id; the cost is
//      computed from the token counts the model returned, not from a constant; without counts the reservation estimate stays.
//   3. REFUSAL: at the cap, or over it, the handler answers 402 budget_exhausted, makes ZERO model calls and writes no row.
//   4. CONCURRENCY: concurrent calls never spend past the cap (some may be refused although they would have fitted, a documented
//      limit); sequential calls fill the cap exactly.
//   5. FAIL CLOSED: a ledger that cannot be read, cannot take the row, or returns nonsense refuses the call; a model with no price,
//      no budget wired, or a request with no organisation and user is refused; nothing calls the model.
//   6. PRICE PARITY: the default price equals MODEL_PRICING in src/lib/llm-client.ts.
// Lives under src/ because bunfig.toml sets [test] root = "src". Run: bun test --isolate src/lib/services/projexa-document-extract-budget.test.ts
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { handleProjexaDocumentExtract, bearerMatches, type ExtractDeps, type ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"
import {
  BUDGET_FEATURE_KEY,
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_PRICE_TABLE,
  attributionFromHeaders,
  decideBudget,
  estimateCostUsd,
  parseCapUsd,
  reserveBudget,
  type BudgetDeps,
} from "../../../supabase/functions/projexa-document-extract/budget"
import { estimateCostUsd as platformEstimateCostUsd } from "../llm-client"
import { SHARED_SECRET } from "./__test-helpers__/document-extraction-fixtures"
import { TEST_ORG, TEST_USER, memoryBudgetLedger, testBudget, type MemoryBudgetLedger } from "./__test-helpers__/extract-budget-fixtures"

const FUNCTION_DIR = new URL("../../../supabase/functions/projexa-document-extract/", import.meta.url)
const source = (name: string) => readFileSync(new URL(name, FUNCTION_DIR), "utf8")

const goodBody = JSON.stringify({ schema: "boq_project_v1", fileName: "villa.xlsx", sheets: [{ name: "Civil", rows: [{ row: 4, cells: ["1.01", "Excavation", "m3", "100", "250"] }] }] })

function post(headers: Record<string, string> = {}) {
  return new Request("https://edge.test/functions/v1/projexa-document-extract", {
    method: "POST",
    headers: { authorization: `Bearer ${SHARED_SECRET}`, "content-type": "application/json", ...headers },
    body: goodBody,
  })
}

const REPLY = JSON.stringify({ schema: "boq_project_v1" })

/** The real handler with a counting model. `reply` is what the model returns. */
function setup(opts: { reply?: string | { text: string; usage?: { promptTokens: number; completionTokens: number } }; budget?: Partial<BudgetDeps> | null; model?: ModelCall | null } = {}) {
  const state = { modelCalls: 0, logs: [] as string[] }
  const model: ModelCall = opts.model
    ? opts.model
    : async () => {
        state.modelCalls++
        return opts.reply ?? REPLY
      }
  const budget = opts.budget === null ? null : testBudget(opts.budget ?? {})
  const d: ExtractDeps = {
    verifyCaller: async (req) => bearerMatches(req.headers.get("authorization"), SHARED_SECRET),
    model: opts.model === null ? null : model,
    budget,
    log: (line) => state.logs.push(line),
  }
  return { d, state, budget, ledger: budget?.ledger as MemoryBudgetLedger }
}

async function call(d: ExtractDeps, headers: Record<string, string> = {}) {
  const res = await handleProjexaDocumentExtract(post(headers), d)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** What one call of goodBody reserves: read from a run whose model returns no token counts, so the estimate stays in the row. */
async function estimateOfOneCall(): Promise<number> {
  const { d, ledger } = setup({ reply: REPLY })
  expect((await call(d)).status).toBe(200)
  return ledger.rows[0].estimatedCostUsd
}

describe("the rule: decideBudget", () => {
  test("under the cap allows and reports what is left", () => {
    const d = decideBudget({ recordedTotalUsd: 0.4, estimateUsd: 0.1, capUsd: 1 })
    expect(d).toEqual({ allow: true, remainingUsd: 0.5 })
  })

  test("a recorded total at the cap, or over it, refuses: cap_reached", () => {
    expect(decideBudget({ recordedTotalUsd: 1, estimateUsd: 0, capUsd: 1 })).toEqual({ allow: false, reason: "cap_reached" })
    expect(decideBudget({ recordedTotalUsd: 1.2, estimateUsd: 0.001, capUsd: 1 })).toEqual({ allow: false, reason: "cap_reached" })
  })

  test("a call whose estimate would carry the total over the cap refuses: would_exceed; landing exactly on the cap is allowed", () => {
    expect(decideBudget({ recordedTotalUsd: 0.995, estimateUsd: 0.006, capUsd: 1 })).toEqual({ allow: false, reason: "would_exceed" })
    expect(decideBudget({ recordedTotalUsd: 0.995, estimateUsd: 0.005, capUsd: 1 })).toEqual({ allow: true, remainingUsd: 0 })
  })

  test("a figure that is not a finite non-negative number refuses as invalid_input", () => {
    for (const bad of [Number.NaN, -0.01, Number.POSITIVE_INFINITY]) {
      expect(decideBudget({ recordedTotalUsd: bad, estimateUsd: 0.01, capUsd: 1 })).toEqual({ allow: false, reason: "invalid_input" })
      expect(decideBudget({ recordedTotalUsd: 0, estimateUsd: bad, capUsd: 1 })).toEqual({ allow: false, reason: "invalid_input" })
      expect(decideBudget({ recordedTotalUsd: 0, estimateUsd: 0.01, capUsd: bad })).toEqual({ allow: false, reason: "invalid_input" })
    }
  })

  test("float noise does not move the line: a total of 0.1 + 0.2 against a cap of 0.3 is at the cap", () => {
    expect(decideBudget({ recordedTotalUsd: 0.1 + 0.2, estimateUsd: 0, capUsd: 0.3 })).toEqual({ allow: false, reason: "cap_reached" })
  })
})

describe("the cap is configuration", () => {
  test("the default is 1.00 USD (PMD-43)", () => {
    expect(DEFAULT_BUDGET_CAP_USD).toBe(1)
    expect(parseCapUsd(undefined)).toBe(1)
    expect(parseCapUsd("")).toBe(1)
    expect(parseCapUsd("  ")).toBe(1)
  })

  test("a value is read as it is written; a value that is not a plain non-negative number is 0, which refuses every call", () => {
    expect(parseCapUsd("2.5")).toBe(2.5)
    expect(parseCapUsd("0.01")).toBe(0.01)
    for (const bad of ["abc", "-1", "1e3", "1,5", "Infinity", "NaN", "0x10"]) expect(parseCapUsd(bad)).toBe(0)
  })

  test("a cap read from configuration is the one the handler applies", async () => {
    const est = await estimateOfOneCall()
    const tight = setup({ budget: { capUsd: parseCapUsd(String(est / 2)) } })
    expect((await call(tight.d)).status).toBe(402)
    const roomy = setup({ budget: { capUsd: parseCapUsd(String(est * 2)) } })
    expect((await call(roomy.d)).status).toBe(200)
  })
})

describe("metering: an allowed call writes exactly one ledger row", () => {
  test("the row carries the organisation, the user, the model, the provider, the tokens, the cost and the request id", async () => {
    const { d, ledger, state } = setup({ reply: { text: REPLY, usage: { promptTokens: 1200, completionTokens: 300 } } })
    const res = await call(d)
    expect(res.status).toBe(200)
    expect(state.modelCalls).toBe(1)
    expect(ledger.rows).toHaveLength(1)
    const row = ledger.rows[0]
    expect(row).toMatchObject({
      orgId: TEST_ORG,
      userId: TEST_USER,
      model: "openai/gpt-oss-120b",
      provider: "groq",
      feature: BUDGET_FEATURE_KEY,
      promptTokens: 1200,
      completionTokens: 300,
      success: true,
      failureReason: null,
      usageSource: "provider",
    })
    expect(row.requestId).toMatch(/^req-\d+$/)
    // The exact cost is 0.0000972 USD; a recorded cost is rounded up to a micro-dollar.
    expect(row.estimatedCostUsd).toBe(0.000098)
  })

  test("the cost comes from the token counts the model returned, not from a constant", async () => {
    const small = setup({ reply: { text: REPLY, usage: { promptTokens: 1000, completionTokens: 100 } } })
    const large = setup({ reply: { text: REPLY, usage: { promptTokens: 50_000, completionTokens: 20_000 } } })
    await call(small.d)
    await call(large.d)
    const price = DEFAULT_PRICE_TABLE["openai/gpt-oss-120b"]
    expect(small.ledger.rows[0].estimatedCostUsd).toBe(estimateCostUsd(price, 1000, 100))
    expect(large.ledger.rows[0].estimatedCostUsd).toBe(estimateCostUsd(price, 50_000, 20_000))
    expect(large.ledger.rows[0].estimatedCostUsd).toBeGreaterThan(small.ledger.rows[0].estimatedCostUsd * 10)
  })

  test("a model that reports no token counts leaves the reservation estimate as the recorded cost, flagged as estimated", async () => {
    const { d, ledger } = setup({ reply: REPLY })
    await call(d)
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0].usageSource).toBe("estimated")
    expect(ledger.rows[0].estimatedCostUsd).toBeGreaterThan(0)
    expect(ledger.rows[0].promptTokens).toBeGreaterThan(0)
  })

  test("counts that are not whole non-negative numbers are ignored: the estimate stays", async () => {
    for (const usage of [{ promptTokens: -5, completionTokens: 10 }, { promptTokens: 1.5, completionTokens: 10 }, { promptTokens: Number.NaN, completionTokens: 10 }]) {
      const { d, ledger } = setup({ reply: { text: REPLY, usage } })
      await call(d)
      expect(ledger.rows[0].usageSource).toBe("estimated")
    }
  })

  test("tokens are recorded even when the reply turns out not to be JSON (the money was spent)", async () => {
    const { d, ledger } = setup({ reply: { text: "Sure, here you go", usage: { promptTokens: 700, completionTokens: 50 } } })
    const res = await call(d)
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ ok: false, code: "model_output_not_json" })
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]).toMatchObject({ promptTokens: 700, completionTokens: 50, usageSource: "provider" })
  })

  test("a model call that throws is recorded as a failed call and keeps its estimate (the provider may have billed it)", async () => {
    const { d, ledger } = setup({
      model: async () => {
        throw new Error("provider down")
      },
    })
    const res = await call(d)
    expect(res.status).toBe(502)
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]).toMatchObject({ success: false, failureReason: "model_error", usageSource: "estimated" })
    expect(ledger.rows[0].estimatedCostUsd).toBeGreaterThan(0)
  })

  test("the pre-call estimate is an upper bound: a call is reserved for the whole output ceiling and the whole input", async () => {
    const { d, ledger } = setup({ reply: { text: REPLY, usage: { promptTokens: 10, completionTokens: 10 } } })
    let reserved: number | null = null
    const inner = ledger.insertReservation.bind(ledger)
    ledger.insertReservation = async (row) => {
      reserved = row.estimatedCostUsd
      return inner(row)
    }
    await call(d)
    expect(reserved).not.toBeNull()
    // 80 000 output chars at 2 chars per token is 40 000 tokens, so the reservation is never below that share of the price.
    expect(reserved!).toBeGreaterThanOrEqual((40_000 / 1000) * 0.00018)
  })
})

describe("attribution: every row carries who the call was for", () => {
  test("two organisations and users are recorded separately and their totals add up per organisation", async () => {
    const ledger = memoryBudgetLedger()
    const who = [
      { orgId: "org-a", userId: "user-a1", requestId: "r-1" },
      { orgId: "org-a", userId: "user-a2", requestId: "r-2" },
      { orgId: "org-b", userId: "user-b1", requestId: "r-3" },
    ]
    let i = 0
    const shared = testBudget({ ledger, resolveAttribution: () => who[i++] })
    const { d } = setup({ reply: { text: REPLY, usage: { promptTokens: 2000, completionTokens: 500 } } })
    d.budget = shared
    for (let n = 0; n < 3; n++) expect((await call(d)).status).toBe(200)
    expect(ledger.rows.map((r) => [r.orgId, r.userId, r.requestId])).toEqual(who.map((w) => [w.orgId, w.userId, w.requestId]))
    const perOrg = (org: string) => ledger.rows.filter((r) => r.orgId === org).reduce((s, r) => s + r.estimatedCostUsd, 0)
    expect(perOrg("org-a")).toBeCloseTo(2 * perOrg("org-b"), 9)
  })

  test("a request that does not name its organisation and user is refused 400 attribution_required: no model call, no row", async () => {
    for (const resolve of [() => null, () => { throw new Error("boom") }]) {
      const { d, state, ledger } = setup({ budget: { resolveAttribution: resolve } })
      const res = await call(d)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ ok: false, code: "attribution_required" })
      expect(state.modelCalls).toBe(0)
      expect(ledger.rows).toHaveLength(0)
    }
  })

  test("attributionFromHeaders reads the three headers, makes a request id when none is sent, and refuses a missing or malformed id", () => {
    const h = (o: Record<string, string>) => new Headers(o)
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "org_1", "x-projexa-user-id": "u-9", "x-projexa-request-id": "rq:1" }), () => "gen")).toEqual({ orgId: "org_1", userId: "u-9", requestId: "rq:1" })
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "org_1", "x-projexa-user-id": "u-9" }), () => "gen-7")).toEqual({ orgId: "org_1", userId: "u-9", requestId: "gen-7" })
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "org_1", "x-projexa-user-id": "u-9", "x-projexa-request-id": "bad id!" }), () => "gen-8")?.requestId).toBe("gen-8")
    expect(attributionFromHeaders(h({ "x-projexa-user-id": "u-9" }), () => "g")).toBeNull()
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "org_1" }), () => "g")).toBeNull()
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "a b", "x-projexa-user-id": "u-9" }), () => "g")).toBeNull()
    expect(attributionFromHeaders(h({ "x-projexa-org-id": "x".repeat(200), "x-projexa-user-id": "u-9" }), () => "g")).toBeNull()
  })
})

describe("refusal: the cap", () => {
  test("a recorded total at the cap is 402 budget_exhausted with ZERO model calls and no new row", async () => {
    const { d, state, ledger } = setup({ budget: { capUsd: 1 } })
    ledger.rows.push(...memoryBudgetLedger([{ estimatedCostUsd: 1 }]).rows)
    const res = await call(d)
    expect(res.status).toBe(402)
    expect(res.body).toEqual({ ok: false, code: "budget_exhausted" })
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(1)
  })

  test("a total past the cap (an earlier call cost more than its estimate) is also refused", async () => {
    const { d, state, ledger } = setup({ budget: { capUsd: 1 } })
    ledger.rows.push(...memoryBudgetLedger([{ estimatedCostUsd: 1.37 }]).rows)
    expect((await call(d)).status).toBe(402)
    expect(state.modelCalls).toBe(0)
  })

  test("only rows of this feature count: another feature's spend does not use up the cap", async () => {
    const { d, state, ledger } = setup({ budget: { capUsd: 1 } })
    ledger.rows.push(...memoryBudgetLedger([{ estimatedCostUsd: 5, feature: "some_other_feature" }]).rows)
    expect((await call(d)).status).toBe(200)
    expect(state.modelCalls).toBe(1)
  })

  test("a call that would cross the cap is refused before the model runs, though the recorded total is still under it", async () => {
    const est = await estimateOfOneCall()
    const { d, state, ledger } = setup({ budget: { capUsd: 1 } })
    ledger.rows.push(...memoryBudgetLedger([{ estimatedCostUsd: 1 - est / 2 }]).rows)
    const res = await call(d)
    expect(res.status).toBe(402)
    expect(res.body).toEqual({ ok: false, code: "budget_exhausted" })
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(1)
    expect(state.logs.join("\n")).toContain("would_exceed")
  })

  test("a call that lands exactly on the cap is allowed and the next one is refused", async () => {
    const est = await estimateOfOneCall()
    const { d, state, ledger } = setup({ budget: { capUsd: est } })
    expect((await call(d)).status).toBe(200)
    expect(ledger.rows).toHaveLength(1)
    const next = await call(d)
    expect(next.status).toBe(402)
    expect(state.modelCalls).toBe(1)
    expect(ledger.rows).toHaveLength(1)
  })

  test("the recorded total grows with each call until the cap stops the run (the whole path, call by call)", async () => {
    const est = await estimateOfOneCall()
    const { d, state, ledger } = setup({ budget: { capUsd: est * 3.5 } })
    const statuses: number[] = []
    for (let n = 0; n < 6; n++) statuses.push((await call(d)).status)
    expect(statuses).toEqual([200, 200, 200, 402, 402, 402])
    expect(state.modelCalls).toBe(3)
    expect(ledger.rows).toHaveLength(3)
    expect(ledger.total()).toBeLessThanOrEqual(est * 3.5)
  })
})

describe("concurrency: concurrent calls never spend past the cap", () => {
  test("eight simultaneous calls against a cap that fits three: the recorded total stays under the cap and every refused call made no model call", async () => {
    const est = await estimateOfOneCall()
    const cap = est * 3.5
    const { d, state, ledger } = setup({ budget: { capUsd: cap } })
    const results = await Promise.all(Array.from({ length: 8 }, () => call(d)))
    const allowed = results.filter((r) => r.status === 200).length
    const refused = results.filter((r) => r.status === 402).length
    expect(allowed + refused).toBe(8)
    expect(state.modelCalls).toBe(allowed)
    expect(allowed).toBeLessThanOrEqual(3)
    expect(ledger.total()).toBeLessThanOrEqual(cap)
    // Documented limit: calls that interleave step for step can all be refused although some would have fitted. What must never happen
    // is a total over the cap. A refused call's reservation was given back, so it adds nothing to the total.
    expect(ledger.rows.filter((r) => r.failureReason === "budget_refused").every((r) => r.estimatedCostUsd === 0)).toBe(true)
  })

  test("calls that start together but are not step for step (the second read comes after the other's row) also stay under the cap", async () => {
    const est = await estimateOfOneCall()
    const cap = est * 1.5
    const { d, state, ledger } = setup({ budget: { capUsd: cap } })
    const first = call(d)
    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = call(d)
    const results = await Promise.all([first, second])
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1)
    expect(state.modelCalls).toBeLessThanOrEqual(1)
    expect(ledger.total()).toBeLessThanOrEqual(cap)
  })

  test("reserveBudget itself: two reservations that cannot both fit are never both granted", async () => {
    const ledger = memoryBudgetLedger()
    const budget = testBudget({ ledger, capUsd: 0.01 })
    const who = { orgId: "o", userId: "u", requestId: "r" }
    const size = { inputChars: 10_000, maxOutputChars: 80_000 }
    const outcomes = await Promise.all([reserveBudget(budget, who, size), reserveBudget(budget, who, size), reserveBudget(budget, who, size)])
    expect(outcomes.filter((o) => o.kind === "reserved").length).toBeLessThanOrEqual(1)
    expect(ledger.total()).toBeLessThanOrEqual(0.01)
  })
})

describe("fail closed: bookkeeping that fails never lets a call through", () => {
  test("a ledger that cannot be read: 503 budget_ledger_unavailable, no model call, no row", async () => {
    const { d, state, ledger } = setup()
    ledger.failOn = "read"
    const res = await call(d)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ ok: false, code: "budget_ledger_unavailable" })
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(0)
  })

  test("a ledger that cannot take the reservation row: 503, no model call", async () => {
    const { d, state, ledger } = setup()
    ledger.failOn = "insert"
    const res = await call(d)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ ok: false, code: "budget_ledger_unavailable" })
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(0)
  })

  test("a ledger whose second read fails after the row went in: 503, no model call, and the row is given back (cost 0)", async () => {
    const { d, state, ledger } = setup()
    const read = ledger.readRecordedTotalUsd.bind(ledger)
    let reads = 0
    ledger.readRecordedTotalUsd = async (feature) => {
      if (++reads === 2) throw new Error("second read failed")
      return read(feature)
    }
    const res = await call(d)
    expect(res.status).toBe(503)
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.rows[0]).toMatchObject({ estimatedCostUsd: 0, success: false, failureReason: "budget_refused" })
  })

  test("a ledger that returns a total that is not a number refuses the call", async () => {
    for (const bad of [Number.NaN, -1, "0.5" as unknown as number]) {
      const { d, state, ledger } = setup()
      ledger.readRecordedTotalUsd = async () => bad
      const res = await call(d)
      expect(res.status).toBe(503)
      expect(state.modelCalls).toBe(0)
    }
  })

  test("a release that fails leaves the reservation at its estimate, which over-counts spend (the safe direction)", async () => {
    const est = await estimateOfOneCall()
    const { d, state, ledger } = setup({ budget: { capUsd: est * 1.2 } })
    const read = ledger.readRecordedTotalUsd.bind(ledger)
    let reads = 0
    ledger.readRecordedTotalUsd = async (feature) => {
      // The first read sees an empty ledger; the second sees another call's row on top of this one.
      if (++reads === 2) return (await read(feature)) + est
      return read(feature)
    }
    ledger.failOn = null
    ledger.finalizeReservation = async () => {
      throw new Error("release failed")
    }
    const res = await call(d)
    expect(res.status).toBe(402)
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows[0].estimatedCostUsd).toBe(est)
  })

  test("a settle that fails after the model ran still returns the paid reply, and the reservation keeps the spend counted", async () => {
    const { d, state, ledger } = setup({ reply: { text: REPLY, usage: { promptTokens: 100, completionTokens: 10 } } })
    ledger.finalizeReservation = async () => {
      throw new Error("update failed")
    }
    const res = await call(d)
    expect(res.status).toBe(200)
    expect(state.modelCalls).toBe(1)
    expect(ledger.rows).toHaveLength(1)
    expect(ledger.total()).toBeGreaterThan(0)
    expect(state.logs.some((l) => l.includes("ledger settle failed"))).toBe(true)
  })

  test("a model with no price in the table: 503 model_price_unknown, no model call, no row", async () => {
    const { d, state, ledger } = setup({ budget: { model: "some/unpriced-model" } })
    const res = await call(d)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ ok: false, code: "model_price_unknown" })
    expect(state.modelCalls).toBe(0)
    expect(ledger.rows).toHaveLength(0)
  })

  test("a price table passed in makes a change of model a configuration change: the new model is metered at its own price", async () => {
    const prices = { "some/other-model": { promptPer1k: 0.01, completionPer1k: 0.02 } }
    const { d, ledger } = setup({ budget: { model: "some/other-model", provider: "openrouter", prices }, reply: { text: REPLY, usage: { promptTokens: 1000, completionTokens: 1000 } } })
    expect((await call(d)).status).toBe(200)
    expect(ledger.rows[0]).toMatchObject({ model: "some/other-model", provider: "openrouter" })
    expect(ledger.rows[0].estimatedCostUsd).toBeCloseTo(0.03, 9)
  })

  test("a model with no budget wired is refused 503 budget_not_configured before it is called", async () => {
    const { d, state } = setup({ budget: null })
    const res = await call(d)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ ok: false, code: "budget_not_configured" })
    expect(state.modelCalls).toBe(0)
  })

  test("a broken cap or estimate setting refuses instead of guessing", async () => {
    for (const bad of [{ capUsd: Number.NaN }, { charsPerToken: 0 }, { charsPerToken: -2 }]) {
      const { d, state } = setup({ budget: bad })
      expect((await call(d)).status).toBe(503)
      expect(state.modelCalls).toBe(0)
    }
  })

  test("the caller check and the empty-model check still come first: no credential is 401, no model is 503 model_not_configured", async () => {
    const { d, ledger } = setup()
    const none = await handleProjexaDocumentExtract(new Request("https://edge.test/x", { method: "POST", body: goodBody }), d)
    expect(none.status).toBe(401)
    const noModel = setup({ model: null })
    expect((await call(noModel.d)).body).toEqual({ ok: false, code: "model_not_configured" })
    expect(ledger.rows).toHaveLength(0)
  })
})

describe("price and wiring parity", () => {
  test("the default price equals MODEL_PRICING in src/lib/llm-client.ts for the same tokens", () => {
    for (const [p, c] of [[1000, 1000], [123_456, 7890], [0, 40_000]]) {
      const platform = platformEstimateCostUsd("openai/gpt-oss-120b", { promptTokens: p, completionTokens: c })
      const ours = estimateCostUsd(DEFAULT_PRICE_TABLE["openai/gpt-oss-120b"], p, c)
      expect(platform).not.toBeNull()
      expect(Math.abs(ours - (platform as number))).toBeLessThan(2e-6)
    }
  })

  test("the README names the cap setting, the default and the refusal code", () => {
    const readme = source("README.md")
    expect(readme).toContain("PROJEXA_EXTRACT_BUDGET_CAP_USD")
    expect(readme).toContain("budget_exhausted")
    expect(readme).toContain("402")
    expect(readme).toContain("1.00")
  })

  test("index.ts still wires no model, so no call can be made before a ledger-backed budget is wired with it", () => {
    const index = source("index.ts")
    expect(index).toMatch(/model:\s*null/)
    expect(index).toMatch(/budget:\s*null/)
  })

  test("no credential, key or URL is in the budget code", () => {
    const budget = source("budget.ts")
    expect(budget).not.toMatch(/https?:\/\//)
    expect(budget).not.toMatch(/sk-|gsk_|eyJ/)
  })
})
