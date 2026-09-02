/// <reference types="bun-types" />
// R67 lane D22 (item D-58). Covers the two pure decisions in
// org-directory-service.ts: what a typed query matches, and how a caller's
// limit is clamped. listOrgDirectory() itself is one withTenantContext read
// and is exercised through the API surface, not by mocking drizzle.
import { describe, expect, test } from "bun:test"
import { matchesDirectoryQuery, resolveDirectoryLimit, filterDirectoryRows, ORG_DIRECTORY_MAX_LIMIT } from "./org-directory-service"

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

// R67 lane D22 (item D-75) -- the acceptance clause "org-users route returns
// only users of the calling org", asserted where it can actually be asserted.
describe("filterDirectoryRows", () => {
  const mine = { id: "u1", orgId: "org_a", name: "Arjun Mehta", email: "arjun@a.test", role: "pm", isActive: true }
  const alsoMine = { id: "u2", orgId: "org_a", name: "Priya Nair", email: "priya@a.test", role: "site_engineer", isActive: true }
  const leaver = { id: "u3", orgId: "org_a", name: "Arun Gone", email: "arun@a.test", role: "pm", isActive: false }
  const otherOrg = { id: "u4", orgId: "org_b", name: "Arjun Other", email: "arjun@b.test", role: "admin", isActive: true }

  test("returns ONLY users of the calling org -- another org's staff never reach a picker", () => {
    const rows = filterDirectoryRows([mine, alsoMine, otherOrg], { orgId: "org_a" })
    expect(rows.map((u) => u.id)).toEqual(["u1", "u2"])
    expect(rows.some((u) => u.orgId !== "org_a")).toBe(false)
  })

  test("a name that matches in another org is still not returned", () => {
    // Both people are called "Arjun ..."; only the caller's own is a result.
    const rows = filterDirectoryRows([mine, otherOrg], { orgId: "org_a", q: "Arjun" })
    expect(rows.map((u) => u.id)).toEqual(["u1"])
  })

  test("leavers are excluded -- work is never assigned to a deactivated user", () => {
    expect(filterDirectoryRows([mine, leaver], { orgId: "org_a" }).map((u) => u.id)).toEqual(["u1"])
  })

  test("the cap applies after filtering, so the page is never padded with foreign rows", () => {
    expect(filterDirectoryRows([mine, alsoMine, otherOrg], { orgId: "org_a", limit: 1 }).map((u) => u.id)).toEqual(["u1"])
  })

  // R67 D-77: resolving ids a screen already holds into names.
  test("resolving by id returns exactly those people, and never one from another org", () => {
    expect(filterDirectoryRows([mine, alsoMine, otherOrg], { orgId: "org_a", ids: ["u2"] }).map((u) => u.id)).toEqual(["u2"])
    expect(filterDirectoryRows([mine, otherOrg], { orgId: "org_a", ids: ["u4"] })).toEqual([])
  })

  test("resolving by id ignores the search term rather than intersecting with it", () => {
    // A screen holding an id has no query to offer; requiring one would make id
    // resolution impossible.
    expect(filterDirectoryRows([mine, alsoMine], { orgId: "org_a", ids: ["u2"], q: "Arjun" }).map((u) => u.id)).toEqual(["u2"])
  })
})
