// Task #47 gap fix (PM-platform feature-parity gap analysis): pms_milestones
// already had the right shape and links from pms_issues.milestoneId, but
// nothing computed/derived a milestone's completion percentage from its
// linked issues -- see the fuller design-decision comment on
// computeMilestoneCompletionPercentage() itself in pms-taxonomy-service.ts.
// Matches this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// pms-issue-service.test.ts's own header, erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { computeMilestoneCompletionPercentage, pickDefaultIssueTypeId } from "./pms-taxonomy-service"

describe("computeMilestoneCompletionPercentage", () => {
  test("a milestone with zero linked issues is 0% (documented choice: 0, not null -- matches construction-dashboard-service.ts's getProjectDashboard() defaulting progressPercent to 0 with no activities)", () => {
    expect(computeMilestoneCompletionPercentage([])).toBe(0)
  })

  test("a milestone with several linked issues at varying completion is the correct average, rounded", () => {
    // (0 + 50 + 100) / 3 = 50 exactly
    expect(computeMilestoneCompletionPercentage([0, 50, 100])).toBe(50)
    // (10 + 20 + 25) / 3 = 18.33... rounds to 18
    expect(computeMilestoneCompletionPercentage([10, 20, 25])).toBe(18)
  })

  test("a single linked issue's own percentage becomes the milestone's percentage exactly", () => {
    expect(computeMilestoneCompletionPercentage([64])).toBe(64)
  })

  test("all linked issues at 100% average to 100%; all at 0% average to 0%", () => {
    expect(computeMilestoneCompletionPercentage([100, 100, 100])).toBe(100)
    expect(computeMilestoneCompletionPercentage([0, 0])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// R67 F-33 (audit recommendation R-278): the two lookups the schedule task
// create path used to pay a round trip for on every POST.
// ---------------------------------------------------------------------------

describe("pickDefaultIssueTypeId", () => {
  test("the org's own default type wins, wherever it sits in the list", () => {
    expect(pickDefaultIssueTypeId([
      { id: "bug", isDefault: false },
      { id: "task", isDefault: true },
    ])).toBe("task")
  })

  test("with no type marked default, the first by name is used -- the order listIssueTypes() returns", () => {
    expect(pickDefaultIssueTypeId([
      { id: "bug", isDefault: false },
      { id: "task", isDefault: null },
    ])).toBe("bug")
  })

  test("an org with no issue types at all resolves to null, not to a fabricated id", () => {
    expect(pickDefaultIssueTypeId([])).toBeNull()
  })
})

const F33_ORG = "org-taxonomy-f33"
const F33_PROJECT = "project-taxonomy-f33"

let f33TypeReads = 0
let f33StatusReads = 0
let f33Types: Array<{ id: string; isDefault: boolean | null }> = []
let f33Statuses: Array<{ id: string; isDefault: boolean; position: number }> = []

const f33RealTenantScoped = await import("@/lib/db/tenant-scoped")

/** Only what the two resolvers actually touch. */
const f33Db = {
  query: {
    pmsIssueTypes: {
      findMany: async () => {
        f33TypeReads += 1
        return f33Types
      },
    },
    pmsIssueStatuses: {
      findMany: async () => {
        f33StatusReads += 1
        return f33Statuses
      },
    },
  },
  insert: () => ({ values: () => ({ returning: async () => f33Statuses }) }),
}

describe("resolveDefaultIssueTypeId / resolveDefaultStatusId -- the 60 s lookup cache", () => {
  beforeEach(async () => {
    const { resetScheduleLookupCache } = await import("./schedule-lookup-cache")
    resetScheduleLookupCache()
    f33TypeReads = 0
    f33StatusReads = 0
    f33Types = [{ id: "type-bug", isDefault: false }, { id: "type-task", isDefault: true }]
    f33Statuses = [{ id: "status-backlog", isDefault: true, position: 0 }]
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...f33RealTenantScoped,
      withTenantContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(f33Db),
    }))
  })

  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => f33RealTenantScoped)
  })

  test("the issue type is read once and then answered without touching the DB again", async () => {
    const { resolveDefaultIssueTypeId } = await import("./pms-taxonomy-service")
    expect(await resolveDefaultIssueTypeId({ orgId: F33_ORG })).toBe("type-task")
    expect(await resolveDefaultIssueTypeId({ orgId: F33_ORG })).toBe("type-task")
    expect(f33TypeReads).toBe(1)
  })

  test("the cache hit is reported to the caller, so a timing line can say the query did not run", async () => {
    const { resolveDefaultIssueTypeId } = await import("./pms-taxonomy-service")
    let hits = 0
    await resolveDefaultIssueTypeId({ orgId: F33_ORG }, { onCacheHit: () => { hits += 1 } })
    await resolveDefaultIssueTypeId({ orgId: F33_ORG }, { onCacheHit: () => { hits += 1 } })
    expect(hits).toBe(1)
  })

  test("one org's cached type is never served to another org", async () => {
    const { resolveDefaultIssueTypeId } = await import("./pms-taxonomy-service")
    await resolveDefaultIssueTypeId({ orgId: F33_ORG })
    f33Types = [{ id: "type-other-org", isDefault: true }]
    expect(await resolveDefaultIssueTypeId({ orgId: "a-different-org" })).toBe("type-other-org")
    expect(f33TypeReads).toBe(2)
  })

  test("an org with NO issue types is not cached -- the refusal clears the moment an admin configures one", async () => {
    const { resolveDefaultIssueTypeId } = await import("./pms-taxonomy-service")
    f33Types = []
    expect(await resolveDefaultIssueTypeId({ orgId: F33_ORG })).toBeNull()
    f33Types = [{ id: "type-task", isDefault: true }]
    expect(await resolveDefaultIssueTypeId({ orgId: F33_ORG })).toBe("type-task")
    expect(f33TypeReads).toBe(2)
  })

  test("creating an issue type drops the cached answer, so the next create sees the new taxonomy", async () => {
    const { resolveDefaultIssueTypeId } = await import("./pms-taxonomy-service")
    const { bustScheduleLookupCache, issueTypeCacheKey } = await import("./schedule-lookup-cache")
    await resolveDefaultIssueTypeId({ orgId: F33_ORG })
    bustScheduleLookupCache(F33_ORG, issueTypeCacheKey(F33_ORG))
    await resolveDefaultIssueTypeId({ orgId: F33_ORG })
    expect(f33TypeReads).toBe(2)
  })

  test("the project's default status is read once and then cached, per project", async () => {
    const { resolveDefaultStatusId } = await import("./pms-taxonomy-service")
    const db = f33Db as unknown as Parameters<typeof resolveDefaultStatusId>[0]
    expect(await resolveDefaultStatusId(db, F33_ORG, F33_PROJECT)).toBe("status-backlog")
    expect(await resolveDefaultStatusId(db, F33_ORG, F33_PROJECT)).toBe("status-backlog")
    expect(f33StatusReads).toBe(1)

    f33Statuses = [{ id: "status-of-another-project", isDefault: true, position: 0 }]
    expect(await resolveDefaultStatusId(db, F33_ORG, "a-different-project")).toBe("status-of-another-project")
    expect(f33StatusReads).toBe(2)
  })
})
