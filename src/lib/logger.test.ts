/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { logger, getCorrelationId } from "./logger"

function captureConsole() {
  const calls: { method: "log" | "warn" | "error"; line: string }[] = []
  const originals = { log: console.log, warn: console.warn, error: console.error }
  console.log = mock((line: string) => calls.push({ method: "log", line }))
  console.warn = mock((line: string) => calls.push({ method: "warn", line }))
  console.error = mock((line: string) => calls.push({ method: "error", line }))
  return {
    calls,
    restore: () => {
      console.log = originals.log
      console.warn = originals.warn
      console.error = originals.error
    },
  }
}

describe("logger", () => {
  let cap: ReturnType<typeof captureConsole>

  beforeEach(() => {
    cap = captureConsole()
  })

  afterEach(() => {
    cap.restore()
  })

  test("info emits a single JSON line via console.log with timestamp/level/message", () => {
    logger.info("widget created", { orgId: "org_1" })
    expect(cap.calls.length).toBe(1)
    expect(cap.calls[0].method).toBe("log")
    const parsed = JSON.parse(cap.calls[0].line)
    expect(parsed.level).toBe("info")
    expect(parsed.message).toBe("widget created")
    expect(parsed.orgId).toBe("org_1")
    expect(typeof parsed.timestamp).toBe("string")
    expect(new Date(parsed.timestamp).toString()).not.toBe("Invalid Date")
  })

  test("warn emits via console.warn", () => {
    logger.warn("slow query", { route: "/api/widgets" })
    expect(cap.calls.length).toBe(1)
    expect(cap.calls[0].method).toBe("warn")
    expect(JSON.parse(cap.calls[0].line).level).toBe("warn")
  })

  test("error emits via console.error and normalizes an Error object", () => {
    const err = new Error("boom")
    logger.error("failed to create widget", err, { correlationId: "abc-123" })
    expect(cap.calls.length).toBe(1)
    expect(cap.calls[0].method).toBe("error")
    const parsed = JSON.parse(cap.calls[0].line)
    expect(parsed.level).toBe("error")
    expect(parsed.correlationId).toBe("abc-123")
    expect(parsed.errorName).toBe("Error")
    expect(parsed.errorMessage).toBe("boom")
    expect(typeof parsed.errorStack).toBe("string")
  })

  test("error tolerates a non-Error unknown value (e.g. a thrown string)", () => {
    logger.error("failed", "some raw thrown string")
    const parsed = JSON.parse(cap.calls[0].line)
    expect(parsed.errorDetail).toBe("some raw thrown string")
  })

  test("error with no error argument still emits without throwing", () => {
    expect(() => logger.error("failed, no error object")).not.toThrow()
    const parsed = JSON.parse(cap.calls[0].line)
    expect(parsed.errorName).toBeUndefined()
  })

  test("debug is suppressed at the default (info) level", () => {
    logger.debug("verbose detail")
    expect(cap.calls.length).toBe(0)
  })
})

describe("getCorrelationId", () => {
  test("returns the x-correlation-id header when present", () => {
    const request = new Request("https://example.com/api/widgets", {
      headers: { "x-correlation-id": "corr-1" },
    })
    expect(getCorrelationId(request)).toBe("corr-1")
  })

  test("falls back to x-request-id when x-correlation-id is absent", () => {
    const request = new Request("https://example.com/api/widgets", {
      headers: { "x-request-id": "req-1" },
    })
    expect(getCorrelationId(request)).toBe("req-1")
  })

  test("prefers x-correlation-id over x-request-id when both are present", () => {
    const request = new Request("https://example.com/api/widgets", {
      headers: { "x-correlation-id": "corr-1", "x-request-id": "req-1" },
    })
    expect(getCorrelationId(request)).toBe("corr-1")
  })

  test("mints a fresh UUID when neither header is present", () => {
    const request = new Request("https://example.com/api/widgets")
    const id = getCorrelationId(request)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  test("mints a different UUID on each call with no header", () => {
    const request = new Request("https://example.com/api/widgets")
    expect(getCorrelationId(request)).not.toBe(getCorrelationId(request))
  })
})
