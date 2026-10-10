// PROJEXA-BUILD-001 U-21 (PMD-12): the pure rate maths of the exchange-rate refresh job, with no Deno globals and no I/O, so
// bun can run it under src/lib/services/projexa-timer.test.ts. It is a straight port of buildLiveRatePairs, fetchLiveRates'
// response checks and formatRate in src/lib/exchange-rate-feed-client.ts (the Vercel route's code, which stays until U-41
// removes the cron). The parity test feeds both the same fixtures, so a change to one that is not made in the other fails CI.

export type CurrencyRef = { id: string; code: string }

export type LiveRatesResult = {
  baseCode: string
  rates: Record<string, number>
  lastUpdatedUtc: string
}

export type LiveRatePair = {
  fromCurrencyId: string
  toCurrencyId: string
  rate: string
  rateDate: string
}

export type SkippedCurrency = { code: string; reason: string }

/** open.er-api.com's free "latest rates" endpoint; the base code is the last path segment. */
export const EXCHANGE_RATE_FEED_BASE = "https://open.er-api.com/v6/latest"

export class ExchangeRateFeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExchangeRateFeedError"
  }
}

type ErApiResponse = {
  result?: string
  "error-type"?: string
  base_code?: string
  rates?: Record<string, number>
  time_last_update_utc?: string
}

// Same 10 decimal places as the Vercel path, so a rate written by either is identical for the same feed value.
export function formatRate(value: number): string {
  return value.toFixed(10)
}

/** Validate a parsed feed body the way fetchLiveRates does; throws ExchangeRateFeedError on anything unusable. */
export function parseFeedBody(code: string, data: ErApiResponse): LiveRatesResult {
  if (data.result !== "success") {
    throw new ExchangeRateFeedError(`Exchange-rate feed reported an error for base ${code}: ${data["error-type"] || "unknown error"}`)
  }
  if (!data.rates || typeof data.rates !== "object") {
    throw new ExchangeRateFeedError(`Exchange-rate feed returned no rates for base ${code}`)
  }
  return { baseCode: data.base_code || code, rates: data.rates, lastUpdatedUtc: data.time_last_update_utc || "" }
}

/**
 * For each non-base currency F where the feed gives r (1 base == r F) emit both directions: base -> F at r and F -> base at 1 / r.
 * A currency the feed does not cover, or returns a non-positive rate for, is skipped with a reason.
 */
export function buildLiveRatePairs(
  base: CurrencyRef,
  others: CurrencyRef[],
  live: LiveRatesResult,
  rateDate: string,
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
