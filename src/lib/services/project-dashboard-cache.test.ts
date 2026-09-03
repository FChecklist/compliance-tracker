/// <reference types="bun-types" />
// R67 F-27 -- the per-project dashboard cache.
//
// The properties that matter are the ones that make a cache WRONG rather than
// merely cold: serving another org's figures, serving another project's, or
// surviving a write that moved the number.
import { beforeEach, describe, expect, test } from "bun:test"
import {
  DASHBOARD_CACHE_TTL_MS,
  bustProjectDashboardCache,
  dashboardCacheKey,
  dashboardCacheSize,
  readDashboardCache,
  resetDashboardCache,
  writeDashboardCache,
} from "./project-dashboard-cache"

const T0 = 1_756_800_000_000

beforeEach(() => resetDashboardCache())

describe("read/write", () => {
  test("a written entry reads back within the TTL", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    expect(readDashboardCache("org-1", "proj-1", T0 + 1_000)).toEqual({ budget: 10 })
  })

  test("it expires EXACTLY at the TTL, not a moment later", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    expect(readDashboardCache("org-1", "proj-1", T0 + DASHBOARD_CACHE_TTL_MS - 1)).not.toBeNull()
    expect(readDashboardCache("org-1", "proj-1", T0 + DASHBOARD_CACHE_TTL_MS)).toBeNull()
  })

  test("an expired entry is DELETED on read, so a long-lived instance does not hold one dead entry per project it ever served", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    expect(dashboardCacheSize()).toBe(1)
    readDashboardCache("org-1", "proj-1", T0 + DASHBOARD_CACHE_TTL_MS)
    expect(dashboardCacheSize()).toBe(0)
  })

  test("a miss is null, never undefined-as-a-value", () => {
    expect(readDashboardCache("org-1", "never-written")).toBeNull()
  })
})

describe("scoping -- the two ways a cache serves the wrong figures", () => {
  test("two orgs holding the same project id never see each other's entry", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    writeDashboardCache("org-2", "proj-1", { budget: 99 }, T0)
    expect(readDashboardCache("org-1", "proj-1", T0)).toEqual({ budget: 10 })
    expect(readDashboardCache("org-2", "proj-1", T0)).toEqual({ budget: 99 })
  })

  test("two projects in one org are separate entries", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    writeDashboardCache("org-1", "proj-2", { budget: 20 }, T0)
    expect(readDashboardCache("org-1", "proj-2", T0)).toEqual({ budget: 20 })
  })

  test("the key puts the org FIRST, so an org-wide bust is a prefix scan", () => {
    expect(dashboardCacheKey("org-1", "proj-1").startsWith("org-1:")).toBe(true)
  })
})

describe("bustProjectDashboardCache -- the one helper every write path calls", () => {
  test("busting one project leaves the org's other projects alone", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    writeDashboardCache("org-1", "proj-2", { budget: 20 }, T0)

    expect(bustProjectDashboardCache("org-1", "proj-1")).toBe(1)

    expect(readDashboardCache("org-1", "proj-1", T0)).toBeNull()
    expect(readDashboardCache("org-1", "proj-2", T0)).toEqual({ budget: 20 })
  })

  test("busting with no project drops every project of THAT org and nobody else's", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    writeDashboardCache("org-1", "proj-2", { budget: 20 }, T0)
    writeDashboardCache("org-2", "proj-3", { budget: 30 }, T0)

    expect(bustProjectDashboardCache("org-1")).toBe(2)

    expect(readDashboardCache("org-1", "proj-1", T0)).toBeNull()
    expect(readDashboardCache("org-1", "proj-2", T0)).toBeNull()
    expect(readDashboardCache("org-2", "proj-3", T0)).toEqual({ budget: 30 })
  })

  test("a null projectId is the org-wide case, not a key literally named 'null'", () => {
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    expect(bustProjectDashboardCache("org-1", null)).toBe(1)
    expect(readDashboardCache("org-1", "proj-1", T0)).toBeNull()
  })

  test("busting something that was never cached is a no-op, not a throw -- a write must never fail because a cache was cold", () => {
    expect(bustProjectDashboardCache("org-1", "proj-1")).toBe(0)
    expect(bustProjectDashboardCache("org-nothing")).toBe(0)
  })

  test("an org id that is a prefix of another org's id does not drop the longer one", () => {
    // "org-1" vs "org-10": the separator in the key is what makes this safe.
    writeDashboardCache("org-1", "proj-1", { budget: 10 }, T0)
    writeDashboardCache("org-10", "proj-1", { budget: 99 }, T0)

    bustProjectDashboardCache("org-1")

    expect(readDashboardCache("org-10", "proj-1", T0)).toEqual({ budget: 99 })
  })
})
