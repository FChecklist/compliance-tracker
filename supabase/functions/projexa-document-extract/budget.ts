// PROJEXA-BUILD-001 U-36b (BR-526, PMD-43, PMD-40): the spend cap of the projexa-document-extract Edge Function.
//
// WHAT IT DOES. Every model call of the function is metered in the usage ledger (compliance.token_usage_ledger, the ledger the
// platform already uses for AI spend) with the organisation, the user, the model, the tokens, the estimated cost and a request id,
// and no model call is made once the recorded total for this feature has reached the cap (default 1.00 USD, PMD-43) or when the
// estimated cost of the call would carry the total over it. The handler refuses such a call with 402 budget_exhausted.
//
// SHAPE. decideBudget() is a pure function (recorded total, estimate, cap -> allow or refuse). reserveBudget() and settleBudget() are
// the thin adapter: they read and write the ledger only through the `BudgetLedger` the caller passes in, so bun runs them with an
// in-memory ledger and the deployed function runs them with a database-backed one. This file has no import, like handler.ts, so it
// runs under Deno and under bun unchanged.
//
// FAIL CLOSED. If the ledger cannot be read, cannot take the reservation row, or the model has no price, the model is not called.
// Spend is never allowed because bookkeeping failed.
//
// CONCURRENCY. A check-then-call pattern lets two requests that read the same total both go through. reserveBudget() therefore writes
// a reservation row that carries the ESTIMATED cost first, then reads the total again (own row included) and refuses when the total is
// over the cap, releasing the row. Whichever of two concurrent calls inserts last sees both rows, so two calls can never both slip
// under the cap; the price is that two calls that together would cross the cap can both be refused (a refusal that was not needed,
// never a spend that was not allowed). The pattern needs only an insert, a read of the sum and an update of the own row, so it needs
// no database function. Honest limit: it depends on the ledger returning committed rows to the second read (a single-statement,
// read-committed insert and select, which is what token_usage_ledger gives). The final row holds the cost computed from the
// token counts the provider returned; when the provider returns none, the reservation estimate stays as the recorded cost.

/** The feature name every row of this function carries (token_usage_ledger.layer_key); the cap is applied to the sum of these rows. */
export const BUDGET_FEATURE_KEY = "projexa_document_extract"

/** PMD-43: the hard cap of estimated spend for extraction testing, in USD. Configuration, see parseCapUsd. */
export const DEFAULT_BUDGET_CAP_USD = 1

/** Characters per token used for the pre-call estimate. 2 is deliberately pessimistic (text averages 3 to 4), so the estimate errs high. */
export const DEFAULT_CHARS_PER_TOKEN = 2

/** USD per 1000 tokens, the same unit as MODEL_PRICING in src/lib/llm-client.ts. */
export type ModelPrice = { promptPer1k: number; completionPer1k: number }
export type PriceTable = Record<string, ModelPrice>

// The price table is configuration: a change of model is a new entry (or a table passed in), not a code change (PMD-43). The one
// entry is the platform floor-tier model on Groq; a test holds it equal to MODEL_PRICING in src/lib/llm-client.ts.
export const DEFAULT_PRICE_TABLE: PriceTable = {
  "openai/gpt-oss-120b": { promptPer1k: 0.000036, completionPer1k: 0.00018 },
}

const MICROS_PER_USD = 1_000_000

const validMoney = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
const validCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0

/** Whole micro-dollars, rounded up (used for estimates, so they never round down). */
function ceilMicros(usd: number): number {
  return Math.ceil(usd * MICROS_PER_USD - 1e-6)
}

/** Whole micro-dollars, to the nearest (used for recorded totals and the cap, which are exact figures). */
function roundMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD)
}

const microsToUsd = (micros: number): number => micros / MICROS_PER_USD

/**
 * The cap from its configuration value (the environment variable PROJEXA_EXTRACT_BUDGET_CAP_USD, read where the budget is wired). Unset or blank is the
 * default of 1.00. A value that is not a finite, non-negative number is 0, which refuses every call: a mistyped cap never raises it.
 */
export function parseCapUsd(raw: string | null | undefined): number {
  if (raw === undefined || raw === null || raw.trim() === "") return DEFAULT_BUDGET_CAP_USD
  if (!/^[0-9]+(\.[0-9]+)?$/.test(raw.trim())) return 0
  const n = Number(raw.trim())
  return validMoney(n) ? n : 0
}

/** Estimated cost in USD of a call, from token counts and the model's price, rounded up to a micro-dollar. */
export function estimateCostUsd(price: ModelPrice, promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens / 1000) * price.promptPer1k + (completionTokens / 1000) * price.completionPer1k
  return microsToUsd(ceilMicros(usd))
}

export type BudgetDecision =
  | { allow: true; remainingUsd: number }
  | { allow: false; reason: "cap_reached" | "would_exceed" | "invalid_input" }

/**
 * The whole budget rule. Refuse when the recorded total has reached the cap, and refuse when the recorded total plus the estimate would
 * be over the cap; allow otherwise (a call that lands exactly on the cap is allowed, the next one is refused). A figure that is not a
 * finite non-negative number is refused as invalid_input: bad bookkeeping never lets a call through.
 */
export function decideBudget(input: { recordedTotalUsd: number; estimateUsd: number; capUsd: number }): BudgetDecision {
  if (!validMoney(input.recordedTotalUsd) || !validMoney(input.estimateUsd) || !validMoney(input.capUsd)) return { allow: false, reason: "invalid_input" }
  const recorded = roundMicros(input.recordedTotalUsd)
  const estimate = ceilMicros(input.estimateUsd)
  const cap = roundMicros(input.capUsd)
  if (recorded >= cap) return { allow: false, reason: "cap_reached" }
  if (recorded + estimate > cap) return { allow: false, reason: "would_exceed" }
  return { allow: true, remainingUsd: microsToUsd(cap - recorded - estimate) }
}

export type BudgetAttribution = { orgId: string; userId: string; requestId: string }

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/

/**
 * Who a call is for, from the headers the compliance-tracker server sends (the caller is authenticated by the shared secret, so the
 * server is trusted to name the organisation and user). Returns null when the organisation or the user is missing or malformed. A
 * missing request id is replaced by `newId()`, so every row has one.
 */
export function attributionFromHeaders(headers: { get(name: string): string | null }, newId: () => string): BudgetAttribution | null {
  const orgId = (headers.get("x-projexa-org-id") ?? "").trim()
  const userId = (headers.get("x-projexa-user-id") ?? "").trim()
  if (!ID_PATTERN.test(orgId) || !ID_PATTERN.test(userId)) return null
  const given = (headers.get("x-projexa-request-id") ?? "").trim()
  return { orgId, userId, requestId: ID_PATTERN.test(given) ? given : newId() }
}

/** The row written before the model call. Its cost is the estimate; settleBudget() replaces it with the real figures. */
export type LedgerReservation = BudgetAttribution & {
  feature: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
}

export type LedgerSettlement = {
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  success: boolean
  failureReason: string | null
  /** "provider": the counts came back with the reply. "estimated": they did not, so the reservation estimate stands. */
  usageSource: "provider" | "estimated"
}

/**
 * What the budget needs from the ledger. The deployed version is backed by compliance.token_usage_ledger (columns: org_id, user_id,
 * task_id = request id, layer_key = feature, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd, success,
 * failure_reason). Every method may throw; the adapter treats a throw as "ledger unavailable" and refuses the call.
 */
export interface BudgetLedger {
  /** Sum of estimated_cost_usd of every row of `feature`, reservations included. */
  readRecordedTotalUsd(feature: string): Promise<number>
  /** Inserts the reservation row and returns its id. */
  insertReservation(row: LedgerReservation): Promise<string>
  /** Replaces the tokens and cost of the reservation row with the given figures. */
  finalizeReservation(id: string, settlement: LedgerSettlement): Promise<void>
}

export type BudgetDeps = {
  ledger: BudgetLedger
  provider: string
  model: string
  prices?: PriceTable
  capUsd?: number
  charsPerToken?: number
  feature?: string
  /** Who this request is for; null refuses the request (400 attribution_required). index.ts passes attributionFromHeaders. */
  resolveAttribution: (req: Request) => BudgetAttribution | null
}

export type BudgetReservation = {
  id: string
  price: ModelPrice
  feature: string
  estimatedPromptTokens: number
  estimatedCompletionTokens: number
  estimatedCostUsd: number
}

export type ReserveOutcome =
  | { kind: "reserved"; reservation: BudgetReservation }
  | { kind: "refused"; reason: "cap_reached" | "would_exceed" }
  | { kind: "unavailable"; reason: "ledger_error" | "price_unknown" | "invalid_config" }

const RELEASED: LedgerSettlement = {
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
  success: false,
  failureReason: "budget_refused",
  usageSource: "estimated",
}

/** Best effort: if the release fails the reservation row stays at its estimate, which over-counts spend (the safe direction). */
async function release(ledger: BudgetLedger, id: string): Promise<void> {
  try {
    await ledger.finalizeReservation(id, RELEASED)
  } catch {
    // nothing more to do: see above
  }
}

/**
 * Decides whether the model may be called and, when it may, writes the reservation row. `inputChars` is the size of everything sent to
 * the model (system prompt plus user message) and `maxOutputChars` the output ceiling the model is told, so the estimate is an upper
 * bound of the call. The model must not be called unless this returns kind "reserved".
 */
export async function reserveBudget(
  budget: BudgetDeps,
  who: BudgetAttribution,
  size: { inputChars: number; maxOutputChars: number },
): Promise<ReserveOutcome> {
  const price = (budget.prices ?? DEFAULT_PRICE_TABLE)[budget.model]
  if (!price || !validMoney(price.promptPer1k) || !validMoney(price.completionPer1k)) return { kind: "unavailable", reason: "price_unknown" }
  const capUsd = budget.capUsd ?? DEFAULT_BUDGET_CAP_USD
  const charsPerToken = budget.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN
  if (!validMoney(capUsd) || !(charsPerToken > 0) || !validCount(size.inputChars) || !validCount(size.maxOutputChars)) {
    return { kind: "unavailable", reason: "invalid_config" }
  }
  const feature = budget.feature ?? BUDGET_FEATURE_KEY
  const promptTokens = Math.ceil(size.inputChars / charsPerToken)
  const completionTokens = Math.ceil(size.maxOutputChars / charsPerToken)
  const estimatedCostUsd = estimateCostUsd(price, promptTokens, completionTokens)

  let before: number
  try {
    before = await budget.ledger.readRecordedTotalUsd(feature)
  } catch {
    return { kind: "unavailable", reason: "ledger_error" }
  }
  const first = decideBudget({ recordedTotalUsd: before, estimateUsd: estimatedCostUsd, capUsd })
  if (!first.allow) return first.reason === "invalid_input" ? { kind: "unavailable", reason: "ledger_error" } : { kind: "refused", reason: first.reason }

  let id: string
  try {
    id = await budget.ledger.insertReservation({
      ...who,
      feature,
      provider: budget.provider,
      model: budget.model,
      promptTokens,
      completionTokens,
      estimatedCostUsd,
    })
  } catch {
    return { kind: "unavailable", reason: "ledger_error" }
  }
  if (typeof id !== "string" || id.length === 0) return { kind: "unavailable", reason: "ledger_error" }

  // The second read includes this reservation. Over the cap here means another call reserved in between: give the row back and refuse.
  let after: number
  try {
    after = await budget.ledger.readRecordedTotalUsd(feature)
  } catch {
    await release(budget.ledger, id)
    return { kind: "unavailable", reason: "ledger_error" }
  }
  if (!validMoney(after)) {
    await release(budget.ledger, id)
    return { kind: "unavailable", reason: "ledger_error" }
  }
  if (roundMicros(after) > roundMicros(capUsd)) {
    await release(budget.ledger, id)
    return { kind: "refused", reason: "would_exceed" }
  }
  return {
    kind: "reserved",
    reservation: { id, price, feature, estimatedPromptTokens: promptTokens, estimatedCompletionTokens: completionTokens, estimatedCostUsd },
  }
}

/**
 * Records what the call really cost: the cost is computed from the token counts the provider returned, at the model's price. With no
 * (or malformed) counts the reservation estimate stays as the recorded figure, flagged "estimated". Returns false when the ledger
 * could not be updated; the reservation row is then still in the ledger at its estimate, so the spend stays counted.
 */
export async function settleBudget(
  budget: BudgetDeps,
  reservation: BudgetReservation,
  usage: { promptTokens: number; completionTokens: number } | null,
  outcome: { success: boolean; failureReason: string | null },
): Promise<boolean> {
  const fromProvider = usage !== null && validCount(usage.promptTokens) && validCount(usage.completionTokens)
  const settlement: LedgerSettlement = fromProvider
    ? {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(reservation.price, usage.promptTokens, usage.completionTokens),
        ...outcome,
        usageSource: "provider",
      }
    : {
        promptTokens: reservation.estimatedPromptTokens,
        completionTokens: reservation.estimatedCompletionTokens,
        estimatedCostUsd: reservation.estimatedCostUsd,
        ...outcome,
        usageSource: "estimated",
      }
  try {
    await budget.ledger.finalizeReservation(reservation.id, settlement)
    return true
  } catch {
    return false
  }
}
