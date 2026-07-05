// Wave 79 (AI_OS_CERTIFICATION.md: CI's unit-tests job passed vacuously via
// `bun test --passWithNoTests` since zero test files existed anywhere in the
// repo). This is a real regression test for the Wave 17 hard tool/domain
// allowlist -- if a future edit widens DOMAIN_ALLOWED_TOOLS or breaks the
// null-safety here, CI now actually fails instead of passing by default.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildPurposeClause, isKnownDomain, isToolAllowedForDomain } from "./purpose-bound-ai"

describe("isToolAllowedForDomain", () => {
  test("allows a tool that is in the compliance domain's allowlist", () => {
    expect(isToolAllowedForDomain("compliance", "get_compliance_stats")).toBe(true)
  })

  test("denies a tool not in the domain's allowlist", () => {
    expect(isToolAllowedForDomain("compliance", "delete_everything")).toBe(false)
  })

  test("denies any tool for a domain with an empty allowlist", () => {
    expect(isToolAllowedForDomain("project_management", "get_compliance_stats")).toBe(false)
  })

  test("denies when codeReference is null or undefined", () => {
    expect(isToolAllowedForDomain("compliance", null)).toBe(false)
    expect(isToolAllowedForDomain("compliance", undefined)).toBe(false)
  })

  test("falls back to DEFAULT_DOMAIN when domain is null/undefined", () => {
    expect(isToolAllowedForDomain(null, "get_compliance_stats")).toBe(true)
    expect(isToolAllowedForDomain(undefined, "list_departments")).toBe(true)
  })

  test("denies a tool for an entirely unknown domain", () => {
    expect(isToolAllowedForDomain("sales", "get_compliance_stats")).toBe(false)
  })
})

describe("isKnownDomain", () => {
  test("recognizes registered domains", () => {
    expect(isKnownDomain("compliance")).toBe(true)
    expect(isKnownDomain("project_management")).toBe(true)
    expect(isKnownDomain("erp")).toBe(true)
  })

  test("rejects an unregistered domain", () => {
    expect(isKnownDomain("sales")).toBe(false)
  })
})

describe("buildPurposeClause", () => {
  test("names the domain in the returned clause", () => {
    expect(buildPurposeClause("compliance")).toContain('"compliance"')
  })
})
