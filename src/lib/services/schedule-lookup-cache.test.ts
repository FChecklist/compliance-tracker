/// <reference types="bun-types" />
// R67 F-33 (R-278). The cache is pure in-memory bookkeeping, so every rule it
// makes is assertable without a DB -- including the two that matter most: a
// miss is never stored, and one org's bust never reaches another org's entry.
import { beforeEach, describe, expect, test } from "bun:test"
import {
  SCHEDULE_LOOKUP_TTL_MS,
  bustScheduleLookupCache,
  issueStatusCacheKey,
  issueTypeCacheKey,
  readScheduleLookup,
  resetScheduleLookupCache,
  scheduleLookupCacheSize,
  writeScheduleLookup,
} from "./schedule-lookup-cache"

const ORG = "org-1"
const OTHER_ORG = "org-2"
const PROJECT = "project-1"

beforeEach(() => {
  resetScheduleLookupCache()
})

describe("schedule lookup cache", () => {
  test("the TTL is the 60 s the item asks for", () => {
    expect(SCHEDULE_LOOKUP_TTL_MS).toBe(60_000)
  })

  test("keys put the org first, so an org's entries share a prefix", () => {
    expect(issueTypeCacheKey(ORG).startsWith(`${ORG}:`)).toBe(true)
    expect(issueStatusCacheKey(ORG, PROJECT).startsWith(`${ORG}:`)).toBe(true)
  })

  test("the status key is per project -- two projects in one org do not share a default status", () => {
    expect(issueStatusCacheKey(ORG, "project-a")).not.toBe(issueStatusCacheKey(ORG, "project-b"))
  })

  test("a written value reads back until the TTL, and not one millisecond past it", () => {
    const now = 1_000_000
    writeScheduleLookup(issueTypeCacheKey(ORG), "type-1", now)
    expect(readScheduleLookup(issueTypeCacheKey(ORG), now)).toBe("type-1")
    expect(readScheduleLookup(issueTypeCacheKey(ORG), now + SCHEDULE_LOOKUP_TTL_MS - 1)).toBe("type-1")
    expect(readScheduleLookup(issueTypeCacheKey(ORG), now + SCHEDULE_LOOKUP_TTL_MS)).toBeNull()
  })

  test("an expired entry is dropped on the way out, not left to accumulate", () => {
    const now = 1_000_000
    writeScheduleLookup(issueStatusCacheKey(ORG, PROJECT), "status-1", now)
    expect(scheduleLookupCacheSize()).toBe(1)
    readScheduleLookup(issueStatusCacheKey(ORG, PROJECT), now + SCHEDULE_LOOKUP_TTL_MS)
    expect(scheduleLookupCacheSize()).toBe(0)
  })

  test("an unknown key is a miss, never an empty string", () => {
    expect(readScheduleLookup(issueTypeCacheKey("never-seen"))).toBeNull()
  })

  test("busting one key leaves the org's other entries alone", () => {
    writeScheduleLookup(issueTypeCacheKey(ORG), "type-1")
    writeScheduleLookup(issueStatusCacheKey(ORG, PROJECT), "status-1")
    expect(bustScheduleLookupCache(ORG, issueTypeCacheKey(ORG))).toBe(1)
    expect(readScheduleLookup(issueTypeCacheKey(ORG))).toBeNull()
    expect(readScheduleLookup(issueStatusCacheKey(ORG, PROJECT))).toBe("status-1")
  })

  test("busting an org with no key drops every entry of that org and nothing of another org's", () => {
    writeScheduleLookup(issueTypeCacheKey(ORG), "type-1")
    writeScheduleLookup(issueStatusCacheKey(ORG, PROJECT), "status-1")
    writeScheduleLookup(issueTypeCacheKey(OTHER_ORG), "type-2")

    expect(bustScheduleLookupCache(ORG)).toBe(2)
    expect(readScheduleLookup(issueTypeCacheKey(ORG))).toBeNull()
    expect(readScheduleLookup(issueStatusCacheKey(ORG, PROJECT))).toBeNull()
    expect(readScheduleLookup(issueTypeCacheKey(OTHER_ORG))).toBe("type-2")
  })

  test("busting a key that was never written reports 0, not a throw", () => {
    expect(bustScheduleLookupCache(ORG, issueTypeCacheKey(ORG))).toBe(0)
  })
})
