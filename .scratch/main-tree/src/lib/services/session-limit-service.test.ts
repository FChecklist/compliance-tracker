/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyDeviceLabel, hashSessionToken } from "./session-limit-service"

describe("hashSessionToken", () => {
  test("produces a stable SHA-256 hex digest, never the raw token", () => {
    const hash = hashSessionToken("some-access-token")
    expect(hash).not.toBe("some-access-token")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("is deterministic -- the same token always hashes the same way", () => {
    expect(hashSessionToken("token-a")).toBe(hashSessionToken("token-a"))
  })

  test("different tokens hash differently", () => {
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"))
  })
})

describe("classifyDeviceLabel", () => {
  test("classifies a null user-agent as unknown", () => {
    expect(classifyDeviceLabel(null)).toBe("unknown")
  })

  test("classifies common mobile user-agents as mobile", () => {
    expect(classifyDeviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile")
    expect(classifyDeviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("mobile")
    expect(classifyDeviceLabel("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("mobile")
  })

  test("classifies common desktop user-agents as desktop", () => {
    expect(classifyDeviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0")).toBe("desktop")
    expect(classifyDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1")).toBe("desktop")
  })
})
