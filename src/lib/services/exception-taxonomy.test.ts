// Exception Handling Framework (VERIDIAN Review Framework gap closure,
// 2026-07-18) -- pure-function coverage only, matching this codebase's
// established convention of not exercising withTenantContext/a live DB from
// a .test.ts file (see erp-fixed-assets-service.test.ts's own header).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { ServiceError } from "./compliance-service"
import { classifyError, isRetryableError, withAutomaticRecovery } from "./exception-taxonomy"

describe("ServiceError kind/retryable defaults", () => {
  test("a 4xx defaults to business/non-retryable", () => {
    const error = new ServiceError("title is required", 400)
    expect(error.kind).toBe("business")
    expect(error.retryable).toBe(false)
  })

  test("a 5xx defaults to system/retryable", () => {
    const error = new ServiceError("unexpected failure", 500)
    expect(error.kind).toBe("system")
    expect(error.retryable).toBe(true)
  })

  test("explicit opts override the status-derived default", () => {
    const error = new ServiceError("transient lock contention", 409, { kind: "system", retryable: true })
    expect(error.kind).toBe("system")
    expect(error.retryable).toBe(true)
  })
})

describe("classifyError / isRetryableError", () => {
  test("a business ServiceError is not retryable", () => {
    const error = new ServiceError("disposal already completed", 409)
    expect(classifyError(error)).toEqual({ kind: "business", retryable: false })
    expect(isRetryableError(error)).toBe(false)
  })

  test("a system ServiceError is retryable", () => {
    const error = new ServiceError("db connection reset", 503)
    expect(classifyError(error)).toEqual({ kind: "system", retryable: true })
    expect(isRetryableError(error)).toBe(true)
  })

  test("an unclassified raw error defaults to retryable system fault", () => {
    const error = new Error("something exploded")
    expect(classifyError(error)).toEqual({ kind: "system", retryable: true })
    expect(isRetryableError(error)).toBe(true)
  })
})

describe("withAutomaticRecovery", () => {
  test("returns the result on first success without retrying", async () => {
    let calls = 0
    const result = await withAutomaticRecovery(async () => { calls++; return "ok" })
    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })

  test("retries once on a retryable error, then succeeds", async () => {
    let calls = 0
    const result = await withAutomaticRecovery(async () => {
      calls++
      if (calls === 1) throw new ServiceError("transient", 500)
      return "recovered"
    })
    expect(result).toBe("recovered")
    expect(calls).toBe(2)
  })

  test("does not retry a non-retryable (business) error -- fails on first attempt", async () => {
    let calls = 0
    await expect(withAutomaticRecovery(async () => {
      calls++
      throw new ServiceError("invalid input", 400)
    })).rejects.toThrow("invalid input")
    expect(calls).toBe(1)
  })

  test("gives up after maxRetries and rethrows the last error", async () => {
    let calls = 0
    await expect(withAutomaticRecovery(async () => {
      calls++
      throw new ServiceError("still failing", 500)
    }, { maxRetries: 2 })).rejects.toThrow("still failing")
    expect(calls).toBe(3) // 1 initial attempt + 2 retries
  })
})
