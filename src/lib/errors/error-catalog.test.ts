/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { ERROR_CODES, lookupErrorCode } from "./error-catalog"

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
