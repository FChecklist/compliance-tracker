// REVIEW-FRAMEWORK-WAVE4, Track 1b item 1: the live exchange-rate feed.
//
// Until now erp-accounting-service.ts's exchange-rate area was manual-CRUD
// only -- listExchangeRates/createExchangeRate/getLatestExchangeRate all
// required a human to type in every rate, and nothing ever fetched a real
// one. This is the DB-free HTTP client half of the fix.
//
// Provider: open.er-api.com (the free, no-API-key, daily-updated tier of
// exchangerate-api.com). Chosen because it needs zero secret provisioning --
// unlike whisper-client.ts's OpenAI dependency, this endpoint works out of
// the box, so the feature is live the moment this ships rather than blocked
// on an Owner adding a key. An optional EXCHANGE_RATE_API_KEY is still
// honoured if present (paid tier / higher rate limits), but is never
// required.
//
// Structured exactly like whisper-client.ts's own convention: a pure HTTP
// function whose only I/O is the outbound fetch, plus a pure data-shaping
// helper -- both fully exercisable in a test with a mocked global.fetch and
// no DB access (see exchange-rate-feed-client.test.ts), matching this
// codebase's established "mock globalThis.fetch one layer below the real
// call" test convention (whisper-client.test.ts / llm-client.test.ts).

export class ExchangeRateFeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExchangeRateFeedError"
  }
}

// open.er-api.com's free "latest rates" endpoint. Takes the base currency
// code as the last path segment, e.g. /v6/latest/USD, and returns every
// other currency's rate relative to that base.
const EXCHANGE_RATE_FEED_BASE = "https://open.er-api.com/v6/latest"

export type LiveRatesResult = {
  // The base currency the returned rates are relative to (echoed back by the
  // provider -- 1 unit of this currency == rates[X] units of currency X).
  baseCode: string
  // ISO-code -> rate. Always includes baseCode itself mapped to 1.
  rates: Record<string, number>
  // The provider's own "these rates are as of" timestamp, kept for the
  // audit trail / debugging a stale feed. May be empty if the provider
  // omits it.
  lastUpdatedUtc: string
}

// Shape returned by open.er-api.com. Only the fields we actually consume are
// typed; the provider sends more (documentation/terms_of_use links etc.).
type ErApiResponse = {
  result?: string
  "error-type"?: string
  base_code?: string
  rates?: Record<string, number>
  time_last_update_utc?: string
}

/**
 * Fetch the latest exchange rates for `baseCode` from open.er-api.com.
 * DB-free -- the only I/O is the outbound HTTP request. Fails loud (throws
 * ExchangeRateFeedError) on any non-ok response, provider-reported error, or
 * unusable body, never silently returning a partial/empty result, matching
 * whisper-client.ts's fail-loud posture for an external dependency.
 */
export async function fetchLiveRates(baseCode: string): Promise<LiveRatesResult> {
  const code = baseCode?.trim().toUpperCase()
  if (!code) {
    throw new ExchangeRateFeedError("A base currency code is required to fetch live exchange rates")
  }

  const apiKey = process.env.EXCHANGE_RATE_API_KEY?.trim()
  // The paid tier keys on a different path (/v6/{key}/latest/{base}); the
  // free tier keys on none. Both return the same body shape.
  const url = apiKey
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/${encodeURIComponent(code)}`
    : `${EXCHANGE_RATE_FEED_BASE}/${encodeURIComponent(code)}`

  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } })
  } catch (err) {
    throw new ExchangeRateFeedError(
      `Could not reach the exchange-rate feed (open.er-api.com) for base ${code}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (!res.ok) {
    throw new ExchangeRateFeedError(
      `Exchange-rate feed returned HTTP ${res.status} for base ${code} -- cannot refresh live rates`
    )
  }

  let data: ErApiResponse
  try {
    data = (await res.json()) as ErApiResponse
  } catch {
    throw new ExchangeRateFeedError(`Exchange-rate feed returned a non-JSON body for base ${code}`)
  }

  if (data.result !== "success") {
    // The provider signals a bad base code / rate-limit etc. via
    // result:"error" + error-type -- surface its own reason.
    throw new ExchangeRateFeedError(
      `Exchange-rate feed reported an error for base ${code}: ${data["error-type"] || "unknown error"}`
    )
  }

  if (!data.rates || typeof data.rates !== "object") {
    throw new ExchangeRateFeedError(`Exchange-rate feed returned no rates for base ${code}`)
  }

  return {
    baseCode: data.base_code || code,
    rates: data.rates,
    lastUpdatedUtc: data.time_last_update_utc || "",
  }
}

export type CurrencyRef = { id: string; code: string }

// One row destined for erp_exchange_rates. `rate` is a string because the
// column is numeric and Drizzle takes numeric values as strings (matching
// createExchangeRate's own `input.rate.toString()`).
export type LiveRatePair = {
  fromCurrencyId: string
  toCurrencyId: string
  rate: string
  rateDate: string
}

export type SkippedCurrency = { code: string; reason: string }

// Enough significant figures that round-tripping (e.g. INR->USD then
// USD->INR) stays within a cent for realistic amounts, without pretending to
// a precision the daily feed doesn't have.
function formatRate(value: number): string {
  return value.toFixed(10)
}

/**
 * Turn a provider rate table into the exact rows we persist. Pure -- no DB,
 * no network, no clock -- so the rate math (including the 1/r inversion) is
 * unit-testable in isolation.
 *
 * For each non-base currency F where the feed gives `r` (meaning 1 base == r
 * F), we emit BOTH directions so getLatestExchangeRate() answers either way
 * an invoice/journal-entry line might ask:
 *   base -> F : rate = r
 *   F -> base : rate = 1 / r
 * A currency the feed doesn't cover (or returns a non-positive rate for) is
 * skipped with a reason rather than silently dropped or inserted as garbage.
 */
export function buildLiveRatePairs(
  base: CurrencyRef,
  others: CurrencyRef[],
  live: LiveRatesResult,
  rateDate: string
): { pairs: LiveRatePair[]; skipped: SkippedCurrency[] } {
  const pairs: LiveRatePair[] = []
  const skipped: SkippedCurrency[] = []

  for (const other of others) {
    const code = other.code?.trim().toUpperCase()
    if (!code) {
      skipped.push({ code: other.code || other.id, reason: "currency has no ISO code" })
      continue
    }
    const r = live.rates[code]
    if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) {
      skipped.push({ code, reason: "not covered by the live feed" })
      continue
    }
    pairs.push({ fromCurrencyId: base.id, toCurrencyId: other.id, rate: formatRate(r), rateDate })
    pairs.push({ fromCurrencyId: other.id, toCurrencyId: base.id, rate: formatRate(1 / r), rateDate })
  }

  return { pairs, skipped }
}
