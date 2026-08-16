/// <reference types="bun-types" />
// REVIEW-FRAMEWORK-WAVE4 Track 1b item 1. Proves the open.er-api.com
// integration point AND the rate-inversion math are correct WITHOUT any
// network or DB -- mocks globalThis.fetch, same pattern as
// whisper-client.test.ts / llm-client.test.ts, restoring both fetch and the
// optional EXCHANGE_RATE_API_KEY env var after every test so no other test
// file is affected.
import { describe, expect, test, afterEach } from "bun:test"
import {
  fetchLiveRates,
  buildLiveRatePairs,
  ExchangeRateFeedError,
  type LiveRatesResult,
} from "./exchange-rate-feed-client"

const realFetch = globalThis.fetch
const realApiKey = process.env.EXCHANGE_RATE_API_KEY

afterEach(() => {
  globalThis.fetch = realFetch
  if (realApiKey === undefined) delete process.env.EXCHANGE_RATE_API_KEY
  else process.env.EXCHANGE_RATE_API_KEY = realApiKey
})

describe("fetchLiveRates", () => {
  test("throws before calling fetch when no base code is given", async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return {} as Response }) as typeof fetch
    await expect(fetchLiveRates("")).rejects.toThrow(ExchangeRateFeedError)
    expect(fetchCalled).toBe(false)
  })

  test("hits the free no-key endpoint with the upper-cased base code and returns parsed rates", async () => {
    delete process.env.EXCHANGE_RATE_API_KEY
    let capturedUrl: string | undefined
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        json: async () => ({
          result: "success",
          base_code: "USD",
          time_last_update_utc: "Fri, 17 Jul 2026 00:00:01 +0000",
          rates: { USD: 1, INR: 83.2, EUR: 0.92 },
        }),
      } as Response
    }) as typeof fetch

    const result = await fetchLiveRates("usd")
    expect(capturedUrl).toBe("https://open.er-api.com/v6/latest/USD")
    expect(result.baseCode).toBe("USD")
    expect(result.rates.INR).toBe(83.2)
    expect(result.lastUpdatedUtc).toBe("Fri, 17 Jul 2026 00:00:01 +0000")
  })

  test("uses the keyed endpoint when EXCHANGE_RATE_API_KEY is set", async () => {
    process.env.EXCHANGE_RATE_API_KEY = "secret-key-abc"
    let capturedUrl: string | undefined
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ result: "success", base_code: "USD", rates: { USD: 1 } }) } as Response
    }) as typeof fetch

    await fetchLiveRates("USD")
    expect(capturedUrl).toBe("https://v6.exchangerate-api.com/v6/secret-key-abc/latest/USD")
  })

  test("throws on a non-ok HTTP response", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as typeof fetch
    await expect(fetchLiveRates("USD")).rejects.toThrow(/HTTP 429/)
  })

  test("surfaces the provider's own error-type on result:error", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ result: "error", "error-type": "unsupported-code" }),
    })) as typeof fetch
    await expect(fetchLiveRates("ZZZ")).rejects.toThrow(/unsupported-code/)
  })

  test("throws when the body has no rates object", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ result: "success", base_code: "USD" }),
    })) as typeof fetch
    await expect(fetchLiveRates("USD")).rejects.toThrow(/no rates/)
  })

  test("wraps a network-layer fetch rejection", async () => {
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED") }) as typeof fetch
    await expect(fetchLiveRates("USD")).rejects.toThrow(/Could not reach the exchange-rate feed/)
  })
})

describe("buildLiveRatePairs", () => {
  const base = { id: "cur-usd", code: "USD" }
  const live: LiveRatesResult = {
    baseCode: "USD",
    rates: { USD: 1, INR: 80, EUR: 0.5 },
    lastUpdatedUtc: "",
  }

  test("emits both directions per non-base currency with the inverse rate", () => {
    const { pairs, skipped } = buildLiveRatePairs(
      base,
      [{ id: "cur-inr", code: "INR" }],
      live,
      "2026-07-17"
    )
    expect(skipped).toEqual([])
    expect(pairs).toHaveLength(2)

    const usdToInr = pairs.find((p) => p.fromCurrencyId === "cur-usd" && p.toCurrencyId === "cur-inr")!
    const inrToUsd = pairs.find((p) => p.fromCurrencyId === "cur-inr" && p.toCurrencyId === "cur-usd")!
    expect(Number(usdToInr.rate)).toBeCloseTo(80, 6)
    expect(Number(inrToUsd.rate)).toBeCloseTo(1 / 80, 8)
    expect(usdToInr.rateDate).toBe("2026-07-17")
  })

  test("round-trips to within a cent (INR->USD->INR)", () => {
    const { pairs } = buildLiveRatePairs(base, [{ id: "cur-inr", code: "INR" }], live, "2026-07-17")
    const usdToInr = Number(pairs.find((p) => p.toCurrencyId === "cur-inr")!.rate)
    const inrToUsd = Number(pairs.find((p) => p.fromCurrencyId === "cur-inr")!.rate)
    expect(1000 * inrToUsd * usdToInr).toBeCloseTo(1000, 2)
  })

  test("skips a currency the feed does not cover instead of inserting garbage", () => {
    const { pairs, skipped } = buildLiveRatePairs(
      base,
      [{ id: "cur-inr", code: "INR" }, { id: "cur-xyz", code: "XYZ" }],
      live,
      "2026-07-17"
    )
    expect(pairs).toHaveLength(2) // only INR's two directions
    expect(skipped).toEqual([{ code: "XYZ", reason: "not covered by the live feed" }])
  })

  test("skips a non-positive feed rate", () => {
    const { pairs, skipped } = buildLiveRatePairs(
      base,
      [{ id: "cur-bad", code: "BAD" }],
      { baseCode: "USD", rates: { USD: 1, BAD: 0 }, lastUpdatedUtc: "" },
      "2026-07-17"
    )
    expect(pairs).toHaveLength(0)
    expect(skipped[0].code).toBe("BAD")
  })
})
