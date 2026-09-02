/// <reference types="bun-types" />
// R67 lane D22 (item D-58). Covers the two pure decisions in
// org-directory-service.ts: what a typed query matches, and how a caller's
// limit is clamped. listOrgDirectory() itself is one withTenantContext read
// and is exercised through the API surface, not by mocking drizzle.
import { describe, expect, test } from "bun:test"
import { matchesDirectoryQuery, resolveDirectoryLimit, ORG_DIRECTORY_MAX_LIMIT } from "./org-directory-service"

const arjun = { name: "Arjun Mehta", email: "arjun.mehta@skylinebuilders-demo.veridianai.dev" }
const priya = { name: "Priya Nair", email: "priya@example.test" }

describe("matchesDirectoryQuery", () => {
  test("finds a person from the first letters of their name, case-insensitively", () => {
    expect(matchesDirectoryQuery(arjun, "Arj")).toBe(true)
    expect(matchesDirectoryQuery(arjun, "arj")).toBe(true)
    expect(matchesDirectoryQuery(priya, "arj")).toBe(false)
  })

  test("finds a person from their email when the name is not what the searcher knows", () => {
    expect(matchesDirectoryQuery(arjun, "skylinebuilders")).toBe(true)
    expect(matchesDirectoryQuery(priya, "skylinebuilders")).toBe(false)
  })

  test("matches on a surname too, not only a prefix of the whole string", () => {
    expect(matchesDirectoryQuery(arjun, "Mehta")).toBe(true)
  })

  test("an empty or whitespace query matches everyone, so the picker is usable before a key is pressed", () => {
    expect(matchesDirectoryQuery(arjun, "")).toBe(true)
    expect(matchesDirectoryQuery(arjun, "   ")).toBe(true)
    expect(matchesDirectoryQuery(arjun, undefined)).toBe(true)
  })
})

describe("resolveDirectoryLimit", () => {
  test("defaults to 20 when nothing usable is supplied", () => {
    expect(resolveDirectoryLimit(undefined)).toBe(20)
    expect(resolveDirectoryLimit(null)).toBe(20)
    expect(resolveDirectoryLimit("not a number")).toBe(20)
  })

  test("clamps into 1..max so a picker can never be turned into a staff export", () => {
    expect(resolveDirectoryLimit("5")).toBe(5)
    expect(resolveDirectoryLimit(0)).toBe(1)
    expect(resolveDirectoryLimit(-3)).toBe(1)
    expect(resolveDirectoryLimit(5000)).toBe(ORG_DIRECTORY_MAX_LIMIT)
  })
})
