/// <reference types="bun-types" />
// Priority 5: unit tests for the MISSING_INFORMATION rule's pure resolution
// logic. No DB, no LLM -- matches capability-learning-service.test.ts's own
// precedent for this codebase's pure-function testing style.
import { describe, test, expect } from "bun:test"
import {
  resolvePackageVariable,
  resolvePackageVariables,
  resolvePackageVariablesOrThrow,
  MissingInformationError,
} from "./package-variable-resolver"

describe("resolvePackageVariable", () => {
  test("resolves a colon-separated key: value pair", () => {
    expect(resolvePackageVariable("gstin", "File GST return. gstin: 27ABCDE1234F1Z5")).toBe("27ABCDE1234F1Z5")
  })

  test("resolves an equals-separated key = value pair", () => {
    expect(resolvePackageVariable("period", "Generate return. period = 2026-06")).toBe("2026-06")
  })

  test("matches regardless of underscore/space/case variation in the key", () => {
    expect(resolvePackageVariable("return_period", "Return Period: Q1 2026-27")).toBe("Q1 2026-27")
    expect(resolvePackageVariable("Return Period", "return_period: Q1 2026-27")).toBe("Q1 2026-27")
  })

  test("stops at the next comma/semicolon/newline, not the whole rest of the text", () => {
    expect(resolvePackageVariable("gstin", "gstin: 27ABCDE1234F1Z5, period: 2026-06")).toBe("27ABCDE1234F1Z5")
  })

  test("returns null when the variable is never named in the text", () => {
    expect(resolvePackageVariable("gstin", "File the GST return for this quarter")).toBeNull()
  })

  test("returns null on empty variable name or empty source text", () => {
    expect(resolvePackageVariable("", "gstin: 123")).toBeNull()
    expect(resolvePackageVariable("gstin", "")).toBeNull()
  })

  test("does not match a bare mention of the key with no value attached", () => {
    expect(resolvePackageVariable("gstin", "Please check the gstin before filing")).toBeNull()
  })
})

describe("resolvePackageVariables", () => {
  test("resolves multiple variables, reporting only the truly missing ones", () => {
    const { resolved, missing } = resolvePackageVariables(
      ["gstin", "period", "returnType"],
      "gstin: 27ABCDE1234F1Z5\nperiod: 2026-06"
    )
    expect(resolved).toEqual({ gstin: "27ABCDE1234F1Z5", period: "2026-06" })
    expect(missing).toEqual(["returnType"])
  })

  test("empty requiredVariables list resolves to nothing missing", () => {
    expect(resolvePackageVariables([], "anything")).toEqual({ resolved: {}, missing: [] })
  })

  test("never invents a value -- an unresolvable variable is always reported missing, never defaulted", () => {
    const { resolved, missing } = resolvePackageVariables(["amount"], "Please process this task quickly")
    expect(resolved).toEqual({})
    expect(missing).toEqual(["amount"])
  })
})

describe("resolvePackageVariablesOrThrow", () => {
  test("returns resolved values when nothing is missing", () => {
    expect(resolvePackageVariablesOrThrow(["gstin"], "gstin: 27ABCDE1234F1Z5")).toEqual({ gstin: "27ABCDE1234F1Z5" })
  })

  test("throws a typed MissingInformationError carrying the missing variable names", () => {
    expect(() => resolvePackageVariablesOrThrow(["gstin", "period"], "gstin: 27ABCDE1234F1Z5")).toThrow(MissingInformationError)
    try {
      resolvePackageVariablesOrThrow(["gstin", "period"], "gstin: 27ABCDE1234F1Z5")
      expect(true).toBe(false) // unreachable
    } catch (err) {
      expect(err).toBeInstanceOf(MissingInformationError)
      expect((err as MissingInformationError).missingVariables).toEqual(["period"])
    }
  })
})
