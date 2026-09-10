/// <reference types="bun-types" />
// DOD-C8 fix (2026-09-10, PM ruling): checkOpenRouterBalance's fail-open
// behavior on a non-ok response / unexpected shape / network error is
// CORRECT and unchanged -- OpenRouter enforces its own hard credit limit
// server-side (402 on the actual call), so this check is a courtesy
// early-warning layer, not the last line of defense; forcing fail-closed
// here would make every AI Dev Team role call depend on this one
// endpoint's own reachability, trading a narrow spend-limit gap for a
// broader availability single point of failure. What WAS missing: the
// degradation was invisible ("invisible until the invoice") -- this test
// proves it is now a structured, named log line on every fail-open path,
// with no change to the actual allowed/remainingUsd values.
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

let warnCalls: Array<{ message: string; context: Record<string, unknown> | undefined }>

mock.module("@/lib/logger", () => ({
  logger: {
    warn: (message: string, context?: Record<string, unknown>) => {
      warnCalls.push({ message, context })
    },
    error: () => {},
    info: () => {},
    debug: () => {},
  },
}))

const originalFetch = globalThis.fetch
const originalKey = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  warnCalls = []
  process.env.OPENROUTER_API_KEY = "test-key"
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
})

describe("checkOpenRouterBalance -- DOD-C8 fail-open-but-loud", () => {
  test("non-ok response: still fails open (allowed: true), but logs a structured warning naming the reason", async () => {
    globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch
    const { checkOpenRouterBalance } = await import("./cost-policy")
    const result = await checkOpenRouterBalance()

    expect(result).toEqual({ allowed: true, remainingUsd: null })
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0].context?.reason).toBe("non_ok_response")
    expect(warnCalls[0].context?.httpStatus).toBe(500)
  });

  test("unexpected response shape: still fails open, but logs a structured warning naming the reason", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch
    const { checkOpenRouterBalance } = await import("./cost-policy")
    const result = await checkOpenRouterBalance()

    expect(result).toEqual({ allowed: true, remainingUsd: null })
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0].context?.reason).toBe("unexpected_shape")
  });

  test("network/timeout error: still fails open, but logs a structured warning naming the reason and the real error message", async () => {
    globalThis.fetch = (async () => { throw new Error("simulated network failure") }) as typeof fetch
    const { checkOpenRouterBalance } = await import("./cost-policy")
    const result = await checkOpenRouterBalance()

    expect(result).toEqual({ allowed: true, remainingUsd: null })
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0].context?.reason).toBe("network_or_timeout")
    expect(warnCalls[0].context?.errorMessage).toBe("simulated network failure")
  });

  test("healthy balance: allowed, no warning logged -- the loud logging is fail-open-only, not every call", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 2 } }), { status: 200 })) as typeof fetch
    const { checkOpenRouterBalance } = await import("./cost-policy")
    const result = await checkOpenRouterBalance()

    expect(result).toEqual({ allowed: true, remainingUsd: 8 })
    expect(warnCalls).toHaveLength(0)
  });

  test("confirmed low balance: denied, no warning logged -- this is a real, working check, not a swallowed one", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 9.95 } }), { status: 200 })) as typeof fetch
    const { checkOpenRouterBalance } = await import("./cost-policy")
    const result = await checkOpenRouterBalance()

    expect(result.allowed).toBe(false);
    expect(result.remainingUsd).toBeCloseTo(0.05);
    expect(warnCalls).toHaveLength(0)
  });
});
