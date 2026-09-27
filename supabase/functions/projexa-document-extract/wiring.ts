// PROJEXA-BUILD-002 WP-15 (register row AW-902; BR-509, PMD-43): the two things index.ts hands the handler once a model is switched on, kept here so bun
// can test them (index.ts is Deno.serve and the environment only). No import except ./budget.ts and ./handler.ts, which have none of their own.
//
//   openRouterModel / groqModel   the model call: an OpenAI-compatible chat endpoint, model openai/gpt-oss-120b (the one price row of budget.ts), temperature 0, a JSON
//                    object answer, the handler's abort signal, the token counts the provider returns. Nothing about the document, the key or the reply is logged.
//   ledgerOver(...)  the BudgetLedger over three service-role-only SQL functions (drizzle/0652): the function still reads no table and writes no other row.
import type { BudgetLedger, LedgerReservation, LedgerSettlement } from "./budget.ts"
import type { ModelCall, ModelReply, ModelRequest } from "./handler.ts"

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
export const GROQ_PROVIDER = "groq"
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
export const OPENROUTER_PROVIDER = "openrouter"
export const GROQ_MODEL = "openai/gpt-oss-120b"
/** Groq's own ceiling for this model's completion (reasoning included). */
const MAX_COMPLETION_TOKENS = 65_536

export class ModelCallError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`model call failed with status ${status}`)
    this.name = "ModelCallError"
    this.status = status
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** The completion budget for a reply of at most `maxOutputChars` characters: 2 characters a token (the rate the budget estimate uses) plus room for the model's reasoning. */
export function completionTokensFor(maxOutputChars: number): number {
  return Math.min(Math.ceil(maxOutputChars / 2) + 8_000, MAX_COMPLETION_TOKENS)
}

/** What differs between the two OpenAI-compatible providers this function can call. */
type ProviderCall = { url: string; extraBody: Record<string, unknown> }

function compatibleModel(call: ProviderCall, apiKey: string, fetchImpl: FetchLike): ModelCall {
  return async (req: ModelRequest): Promise<ModelReply> => {
    const res = await fetchImpl(call.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: completionTokensFor(req.maxOutputChars),
        response_format: { type: "json_object" },
        ...call.extraBody,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: req.signal,
    })
    if (!res.ok) {
      // the status and the provider's short error code only: never the body (it can echo the request), the key or the document
      const code = await res.json().then((j: { error?: { code?: unknown; type?: unknown } }) => String(j?.error?.code ?? j?.error?.type ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40)).catch(() => "")
      console.error(`projexa-document-extract: provider answered ${res.status}${code ? ` ${code}` : ""}`)
      throw new ModelCallError(res.status)
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== "string" || text === "") throw new ModelCallError(502)
    const p = body.usage?.prompt_tokens
    const c = body.usage?.completion_tokens
    const usage = Number.isInteger(p) && Number.isInteger(c) ? { promptTokens: p as number, completionTokens: c as number } : undefined
    return { text, ...(usage ? { usage } : {}) }
  }
}

/** Groq. NOTE: its on-demand tier allows 8,000 tokens a minute for this model, so a whole workbook (tens of thousands of tokens) is refused 413 there; see openRouterModel. */
export function groqModel(apiKey: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): ModelCall {
  return compatibleModel({ url: GROQ_URL, extraBody: { reasoning_effort: "medium" } }, apiKey, fetchImpl)
}

/** OpenRouter, the platform's metered internal-AI route, for the same model: no per-minute cap that a workbook can exceed. `require_parameters` keeps the request off a provider that would ignore the JSON mode; `sort: throughput` picks the fastest provider (a whole workbook takes over a minute otherwise). */
export function openRouterModel(apiKey: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): ModelCall {
  return compatibleModel({ url: OPENROUTER_URL, extraBody: { reasoning: { effort: "medium" }, provider: { require_parameters: true, sort: "throughput" } } }, apiKey, fetchImpl)
}

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

export function ledgerOver(rpc: Rpc): BudgetLedger {
  return {
    async readRecordedTotalUsd(feature: string): Promise<number> {
      const { data, error } = await rpc("projexa_extract_ledger_total", { p_feature: feature })
      if (error) throw new Error("ledger total unavailable")
      const total = Number(data)
      if (!Number.isFinite(total) || total < 0) throw new Error("ledger total is not a number")
      return total
    },
    async insertReservation(row: LedgerReservation): Promise<string> {
      const { data, error } = await rpc("projexa_extract_ledger_reserve", {
        p_org_id: row.orgId,
        p_user_id: row.userId,
        p_task_id: row.requestId,
        p_feature: row.feature,
        p_provider: row.provider,
        p_model: row.model,
        p_prompt_tokens: row.promptTokens,
        p_completion_tokens: row.completionTokens,
        p_estimated_cost_usd: row.estimatedCostUsd,
      })
      if (error || typeof data !== "string" || data === "") throw new Error("ledger reservation unavailable")
      return data
    },
    async finalizeReservation(id: string, s: LedgerSettlement): Promise<void> {
      const { error } = await rpc("projexa_extract_ledger_settle", {
        p_id: id,
        p_prompt_tokens: s.promptTokens,
        p_completion_tokens: s.completionTokens,
        p_estimated_cost_usd: s.estimatedCostUsd,
        p_success: s.success,
        p_failure_reason: s.failureReason,
      })
      if (error) throw new Error("ledger settlement unavailable")
    },
  }
}
