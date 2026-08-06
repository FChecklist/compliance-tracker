/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { getRequestIp } from "./request-ip"

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/auth/passcode-login", { headers })
}

describe("getRequestIp", () => {
  test("returns the first entry of x-forwarded-for, trimmed", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" })
    expect(getRequestIp(request)).toBe("203.0.113.5")
  })

  test("trims whitespace around the first x-forwarded-for entry", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "  203.0.113.5  , 70.41.3.18" })
    expect(getRequestIp(request)).toBe("203.0.113.5")
  })

  test("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = requestWithHeaders({ "x-real-ip": "198.51.100.23" })
    expect(getRequestIp(request)).toBe("198.51.100.23")
  })

  test("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.23" })
    expect(getRequestIp(request)).toBe("203.0.113.5")
  })

  test("returns undefined when neither header is present, leaving the fallback to the caller", () => {
    const request = requestWithHeaders({})
    expect(getRequestIp(request)).toBeUndefined()
  })

  test("returns an empty string (not the x-real-ip fallback) when x-forwarded-for is present but empty -- matches the pre-extraction ?? semantics, which only falls through on null/undefined, not on empty string", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "", "x-real-ip": "198.51.100.23" })
    expect(getRequestIp(request)).toBe("")
  })
})
