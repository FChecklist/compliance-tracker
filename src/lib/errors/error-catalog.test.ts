/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { ERROR_CODES, friendlyErrorMessage, lookupErrorCode } from "./error-catalog"

describe("lookupErrorCode", () => {
  test("returns the catalog entry for a known code", () => {
    const entry = lookupErrorCode("NOT_FOUND")
    expect(entry?.friendlyMessage).toBeTruthy()
    expect(entry?.remediationSteps.length).toBeGreaterThan(0)
  })

  test("returns undefined for an unknown code", () => {
    expect(lookupErrorCode("SOMETHING_MADE_UP")).toBeUndefined()
  })

  test("returns undefined for null/undefined", () => {
    expect(lookupErrorCode(undefined)).toBeUndefined()
    expect(lookupErrorCode(null)).toBeUndefined()
  })

  test("every catalog entry has a non-empty friendlyMessage and at least one remediation step or an explicit empty array", () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(entry.friendlyMessage.length, `${code} friendlyMessage`).toBeGreaterThan(0)
      expect(Array.isArray(entry.remediationSteps), `${code} remediationSteps`).toBe(true)
    }
  })
})

// R48/F056 gap-closure ("Cold start does not show a bare 'Failed to fetch'"):
// friendlyErrorMessage() is the drop-in replacement for the
// `err instanceof Error && err.message ? err.message : fallback` ternary,
// wired into the BOQ create flow's catch block (src/app/(app)/scope/page.tsx:152,
// `toast.error(friendlyErrorMessage(err, "Failed to create BOQ"))`). Until this
// test, error-catalog.test.ts exercised lookupErrorCode/ERROR_CODES only --
// this real, wired function had zero coverage.
describe("friendlyErrorMessage", () => {
  test("a raw browser network-failure message is replaced, never shown verbatim -- this IS the bug the requirement targets", () => {
    for (const raw of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      const result = friendlyErrorMessage(new TypeError(raw), "fallback")
      expect(result, `raw message "${raw}" must not reach the user`).not.toBe(raw)
      expect(result).toBe("Couldn't reach the server -- check your connection and try again.")
    }
  })

  test("a real, specific Error message (a genuine backend response) passes through unchanged", () => {
    expect(friendlyErrorMessage(new Error("Title is required"), "fallback")).toBe("Title is required")
  })

  test("a non-Error thrown value falls back to the caller's fallback string", () => {
    expect(friendlyErrorMessage("a plain string throw", "fallback")).toBe("fallback")
    expect(friendlyErrorMessage(undefined, "fallback")).toBe("fallback")
    expect(friendlyErrorMessage(null, "fallback")).toBe("fallback")
    expect(friendlyErrorMessage({ code: 500 }, "fallback")).toBe("fallback")
  })

  test("an Error with an empty message falls back to the caller's fallback string", () => {
    expect(friendlyErrorMessage(new Error(""), "fallback")).toBe("fallback")
  })
})
