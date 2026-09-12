// R85 Addendum 3 v4 (claude_log 379), Phase 8 -- THE HISTORY DEFAULT / RATE
// LIBRARY (spec section E5, gates 8-01..8-08). See boq-rate-history-
// service.ts's own header for the full design (matching rules, the three
// 8-07 isolation layers).
//
// WHY THIS FILE DOES NOT DO A LIVE BEGIN...ROLLBACK, per this codebase's own
// established and documented convention (see e.g. src/lib/services/task-
// capabilities-registry-lockdown.test.ts's header, and capability-registry-
// live.test.ts's CI GAP note): there is no live Postgres connection
// available to `bun test` in CI or in this sandbox (ci.yml hardcodes
// DATABASE_URL/APP_RUNTIME_DATABASE_URL to a placeholder localhost value
// nothing listens on). A committed test that tried to open a real
// transaction here would ECONNREFUSED on every run, proving nothing --
// strictly worse than not having it. So, matching this repo's own pattern:
//   - The REAL, live BEGIN...ROLLBACK proof of 8-07 (both directions, plus a
//     deliberate RLS-bypass demonstrating the exact leak these layers exist
//     to prevent) was run ONCE, live, via the Supabase MCP directly against
//     pcrjmlpuqsbocqfwoxod's real RLS policies on construction_boqs /
//     construction_boq_line_items -- see this PR's description for the full
//     transcript. Nothing was persisted (the whole fixture+proof ran inside
//     one transaction that ended in ROLLBACK).
//   - THIS file proves the same guarantee the way every other test in this
//     repo proves DB-adjacent logic without a live socket: by exercising the
//     REAL service functions (buildCandidatesFromRows, matchRateHistory
//     Candidates, findRateHistoryMatches) against controlled fixtures, with
//     only withTenantContext mocked (same convention as tenant-isolation.
//     test.ts / projexa-records-tenant-isolation.test.ts). The adversarial
//     8-07 tests below are genuinely falsifiable: they feed the service a
//     fixture where BOTH orgs' rows are present in what "the database"
//     returns (simulating the one scenario that matters -- what if RLS and
//     the query's own WHERE clause somehow both failed at once?) and assert
//     the service refuses to leak rather than trusting a single layer. See
//     this file's own falsifiability section (search "PLANT THE DEFECT")
//     for the verified RED/GREEN proof.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import {
  classifyDescriptionMatch,
  matchRateHistoryCandidates,
  formatRateHistoryOffer,
  buildCandidatesFromRows,
  type RateHistoryCandidateLine,
  type RateHistoryMatch,
  type RawRateHistoryRow,
} from "./boq-rate-history-service"

const ORG_A = "org-rate-history-a"
const ORG_B = "org-rate-history-b"

function candidate(overrides: Partial<RateHistoryCandidateLine> = {}): RateHistoryCandidateLine {
  return {
    lineItemId: "line-1",
    boqId: "boq-1",
    orgId: ORG_A,
    projectId: "project-1",
    projectName: "Oakwood Villa",
    date: new Date("2026-08-14T00:00:00Z"),
    quantity: 10,
    rateProject: 85,
    description: "Supply and install 20mm plywood",
    unit: "sqm",
    category: null,
    ...overrides,
  }
}

function rawRow(overrides: Partial<RawRateHistoryRow> = {}): RawRateHistoryRow {
  return {
    lineItemId: "line-1",
    boqId: "boq-1",
    orgId: ORG_A,
    projectId: "project-1",
    projectName: "Oakwood Villa",
    date: new Date("2026-08-14T00:00:00Z"),
    quantity: "10",
    rateProject: "85",
    description: "Supply and install 20mm plywood",
    unit: "sqm",
    category: null,
    ...overrides,
  }
}

// ───────────────────────────────────────────────────────────────────────
// 8-02: exact / near-text / non-match, and the unit + optional trade filter
// ───────────────────────────────────────────────────────────────────────
describe("classifyDescriptionMatch -- 8-02 exact and near-text, no embeddings", () => {
  test("identical strings (already normalized) are an exact match", () => {
    expect(classifyDescriptionMatch("20mm plywood", "20mm plywood")).toBe("exact")
  })

  test("case and surrounding whitespace differences still count as exact (normalized)", () => {
    expect(classifyDescriptionMatch("  20mm PLYWOOD  ", "20mm plywood")).toBe("exact")
  })

  test("internal whitespace differences (double space) still count as exact (normalized)", () => {
    expect(classifyDescriptionMatch("20mm   plywood", "20mm plywood")).toBe("exact")
  })

  test("a longer typed description containing a shorter saved one is a near match", () => {
    expect(classifyDescriptionMatch("20mm plywood", "Supply and install 20mm plywood")).toBe("near")
  })

  test("a shorter typed description contained in a longer saved one is also a near match (either direction)", () => {
    expect(classifyDescriptionMatch("Supply and install 20mm plywood", "20mm plywood")).toBe("near")
  })

  test("a genuinely different description does not match at all", () => {
    expect(classifyDescriptionMatch("20mm plywood", "50mm concrete block")).toBe("none")
  })

  test("empty strings never match", () => {
    expect(classifyDescriptionMatch("", "20mm plywood")).toBe("none")
    expect(classifyDescriptionMatch("20mm plywood", "")).toBe("none")
  })
})

describe("matchRateHistoryCandidates -- unit must match exactly; trade narrows via `category`", () => {
  test("exact description + exact unit -> exact_description_and_unit", () => {
    const result = matchRateHistoryCandidates([candidate()], { description: "Supply and install 20mm plywood", unit: "sqm" })
    expect(result).toHaveLength(1)
    expect(result[0]!.matchMethod).toBe("exact_description_and_unit")
  })

  test("near description + exact unit -> near_text_and_unit", () => {
    const result = matchRateHistoryCandidates(
      [candidate({ description: "20mm plywood" })],
      { description: "Supply and install 20mm plywood", unit: "sqm" }
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.matchMethod).toBe("near_text_and_unit")
  })

  test("same description but a different unit never matches -- unit is exact-only, never near", () => {
    const result = matchRateHistoryCandidates(
      [candidate({ unit: "nos" })],
      { description: "Supply and install 20mm plywood", unit: "sqm" }
    )
    expect(result).toHaveLength(0)
  })

  test("a genuinely different description does not match, even with the right unit", () => {
    const result = matchRateHistoryCandidates(
      [candidate({ description: "50mm concrete block" })],
      { description: "Supply and install 20mm plywood", unit: "sqm" }
    )
    expect(result).toHaveLength(0)
  })

  test("optional trade narrows to lines whose category matches (normalized)", () => {
    const civil = candidate({ lineItemId: "civil-1", category: "Civil" })
    const joinery = candidate({ lineItemId: "joinery-1", category: "Joinery" })
    const result = matchRateHistoryCandidates([civil, joinery], {
      description: "Supply and install 20mm plywood",
      unit: "sqm",
      trade: "civil",
    })
    expect(result.map((m) => m.lineItemId)).toEqual(["civil-1"])
  })

  test("an uncategorised candidate never satisfies a trade-narrowed search", () => {
    const result = matchRateHistoryCandidates([candidate({ category: null })], {
      description: "Supply and install 20mm plywood",
      unit: "sqm",
      trade: "civil",
    })
    expect(result).toHaveLength(0)
  })

  test("results are ordered most-recent first", () => {
    const older = candidate({ lineItemId: "older", date: new Date("2026-01-01T00:00:00Z") })
    const newer = candidate({ lineItemId: "newer", date: new Date("2026-08-14T00:00:00Z") })
    const result = matchRateHistoryCandidates([older, newer], { description: "Supply and install 20mm plywood", unit: "sqm" })
    expect(result.map((m) => m.lineItemId)).toEqual(["newer", "older"])
  })
})

// ───────────────────────────────────────────────────────────────────────
// 8-03/8-04/8-06: the offer always carries full source, never a bare number
// ───────────────────────────────────────────────────────────────────────
describe("formatRateHistoryOffer -- 8-03/8-04 full source, 8-06 recency + count", () => {
  test("zero matches -> no offer", () => {
    expect(formatRateHistoryOffer([])).toBeNull()
  })

  test("a single match -> no 'other matches' text, but full source is present", () => {
    const match: RateHistoryMatch = { ...candidate(), matchMethod: "exact_description_and_unit" }
    const offer = formatRateHistoryOffer([match], "AED")
    expect(offer).not.toBeNull()
    expect(offer!.otherMatchCount).toBe(0)
    expect(offer!.displayText).not.toContain("other match")
    // 8-04: source always visible -- project, date, quantity, rate.
    expect(offer!.mostRecent.projectName).toBe("Oakwood Villa")
    expect(offer!.mostRecent.date).toEqual(new Date("2026-08-14T00:00:00Z"))
    expect(offer!.mostRecent.quantity).toBe(10)
    expect(offer!.mostRecent.rateProject).toBe(85)
    expect(offer!.displayText).toBe("AED 85, Oakwood Villa 14 Aug")
  })

  test("several matches -> most recent highlighted plus an accurate count of the rest (8-06's own example shape)", () => {
    const mostRecent: RateHistoryMatch = {
      ...candidate({ projectName: "Oakwood", date: new Date("2026-08-14T00:00:00Z"), rateProject: 85 }),
      matchMethod: "exact_description_and_unit",
    }
    const others: RateHistoryMatch[] = [
      { ...candidate({ lineItemId: "l2", date: new Date("2026-06-01T00:00:00Z") }), matchMethod: "near_text_and_unit" },
      { ...candidate({ lineItemId: "l3", date: new Date("2026-05-01T00:00:00Z") }), matchMethod: "near_text_and_unit" },
      { ...candidate({ lineItemId: "l4", date: new Date("2026-04-01T00:00:00Z") }), matchMethod: "near_text_and_unit" },
      { ...candidate({ lineItemId: "l5", date: new Date("2026-03-01T00:00:00Z") }), matchMethod: "near_text_and_unit" },
    ]
    const offer = formatRateHistoryOffer([mostRecent, ...others], "AED")
    expect(offer!.otherMatchCount).toBe(4)
    expect(offer!.displayText).toBe("AED 85, Oakwood 14 Aug — 4 other matches")
  })

  test("without a currency label, the number is still shown (never a bare/blank offer)", () => {
    const match: RateHistoryMatch = { ...candidate(), matchMethod: "exact_description_and_unit" }
    const offer = formatRateHistoryOffer([match])
    expect(offer!.displayText).toBe("85, Oakwood Villa 14 Aug")
  })

  test("exactly one other match uses singular 'match', not 'matches'", () => {
    const mostRecent: RateHistoryMatch = { ...candidate(), matchMethod: "exact_description_and_unit" }
    const other: RateHistoryMatch = { ...candidate({ lineItemId: "l2", date: new Date("2026-01-01T00:00:00Z") }), matchMethod: "near_text_and_unit" }
    const offer = formatRateHistoryOffer([mostRecent, other])
    expect(offer!.displayText).toContain("1 other match")
    expect(offer!.displayText).not.toContain("1 other matches")
  })
})

// ───────────────────────────────────────────────────────────────────────
// ★ 8-07 -- THE HARD SECURITY GATE ★
// buildCandidatesFromRows is the application-level (layer 3) re-check --
// see boq-rate-history-service.ts's header for why there are three layers
// and why this is the one provable here without a live database.
// ───────────────────────────────────────────────────────────────────────
describe("buildCandidatesFromRows -- 8-07 adversarial cross-tenant proof (both directions)", () => {
  test("normal case: every row already belongs to the calling org -- no leak, nothing thrown", () => {
    const rows = [rawRow({ lineItemId: "a1", orgId: ORG_A }), rawRow({ lineItemId: "a2", orgId: ORG_A })]
    const result = buildCandidatesFromRows(rows, ORG_A)
    expect(result.map((r) => r.lineItemId)).toEqual(["a1", "a2"])
  })

  test("ADVERSARIAL, direction 1: querying as ORG_A must NEVER return ORG_B's row, even if it were present in what the DB layer returned -- refuses (throws) instead of silently dropping it", () => {
    const rows = [rawRow({ lineItemId: "a1", orgId: ORG_A }), rawRow({ lineItemId: "b1", orgId: ORG_B, rateProject: "999" })]
    expect(() => buildCandidatesFromRows(rows, ORG_A)).toThrow(/8-07 cross-tenant leak blocked/)
  })

  test("ADVERSARIAL, direction 2 (vice versa): querying as ORG_B must NEVER return ORG_A's row either", () => {
    const rows = [rawRow({ lineItemId: "a1", orgId: ORG_A }), rawRow({ lineItemId: "b1", orgId: ORG_B, rateProject: "999" })]
    expect(() => buildCandidatesFromRows(rows, ORG_B)).toThrow(/8-07 cross-tenant leak blocked/)
  })

  test("the thrown error names every foreign org actually seen, not just the first one", () => {
    const rows = [
      rawRow({ lineItemId: "a1", orgId: ORG_A }),
      rawRow({ lineItemId: "b1", orgId: ORG_B }),
      rawRow({ lineItemId: "c1", orgId: "org-rate-history-c" }),
    ]
    try {
      buildCandidatesFromRows(rows, ORG_A)
      throw new Error("expected buildCandidatesFromRows to throw")
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain(ORG_B)
      expect(message).toContain("org-rate-history-c")
    }
  })

  test("a row with no usable rate_project is dropped, not treated as a match or a leak", () => {
    const rows = [rawRow({ lineItemId: "a1", orgId: ORG_A, rateProject: null })]
    expect(buildCandidatesFromRows(rows, ORG_A)).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────
// findRateHistoryMatches: the same 8-07 proof one level up, at the real
// exported entry point a route actually calls -- withTenantContext mocked
// (this repo's established tenant-isolation.test.ts convention), the query
// chain replaced with a thenable stub so the exact rows "the database"
// hands back are fully controlled by each test.
// ───────────────────────────────────────────────────────────────────────
const realTenantScoped = await import("@/lib/db/tenant-scoped")

async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
}

let capturedOrgIds: string[] = []
let fakeRows: unknown[] = []

function makeFakeQueryBuilder() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.from = chain
  builder.innerJoin = chain
  builder.leftJoin = chain
  builder.where = chain
  builder.orderBy = chain
  // Thenable -- `await db.select(...)....orderBy(...)` resolves to fakeRows,
  // without needing to reimplement Drizzle's own SQL builder.
  builder.then = (resolve: (v: unknown) => void) => resolve(fakeRows)
  return builder
}

const mockWithTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  capturedOrgIds.push(ctx.orgId)
  return fn(makeFakeQueryBuilder())
})

beforeEach(() => {
  capturedOrgIds = []
  fakeRows = []
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("findRateHistoryMatches -- org-scoped end to end (8-07)", () => {
  test("only reaches withTenantContext with the org actually passed in", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
    fakeRows = [rawRow({ lineItemId: "a1", orgId: ORG_A })]
    const { findRateHistoryMatches } = await import("./boq-rate-history-service")
    await findRateHistoryMatches({ orgId: ORG_A }, { description: "Supply and install 20mm plywood", unit: "sqm" })

    expect(capturedOrgIds).toEqual([ORG_A])
  })

  test("normal case returns matches for the calling org", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
    fakeRows = [rawRow({ lineItemId: "a1", orgId: ORG_A })]
    const { findRateHistoryMatches } = await import("./boq-rate-history-service")
    const result = await findRateHistoryMatches({ orgId: ORG_A }, { description: "Supply and install 20mm plywood", unit: "sqm" })

    expect(result).toHaveLength(1)
    expect(result[0]!.lineItemId).toBe("a1")
  })

  test("ADVERSARIAL: if the underlying rows ever mixed ORG_A and ORG_B (RLS + the query's WHERE both hypothetically failing at once), calling as ORG_A rejects rather than returning ORG_B's row", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
    fakeRows = [rawRow({ lineItemId: "a1", orgId: ORG_A }), rawRow({ lineItemId: "b1", orgId: ORG_B, rateProject: "999" })]
    const { findRateHistoryMatches } = await import("./boq-rate-history-service")

    await expect(
      findRateHistoryMatches({ orgId: ORG_A }, { description: "Supply and install 20mm plywood", unit: "sqm" })
    ).rejects.toThrow(/8-07 cross-tenant leak blocked/)
  })

  test("ADVERSARIAL, vice versa: the same mixed rows, called as ORG_B, also rejects rather than returning ORG_A's row", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
    fakeRows = [rawRow({ lineItemId: "a1", orgId: ORG_A }), rawRow({ lineItemId: "b1", orgId: ORG_B, rateProject: "999" })]
    const { findRateHistoryMatches } = await import("./boq-rate-history-service")

    await expect(
      findRateHistoryMatches({ orgId: ORG_B }, { description: "Supply and install 20mm plywood", unit: "sqm" })
    ).rejects.toThrow(/8-07 cross-tenant leak blocked/)
  })
})

// ───────────────────────────────────────────────────────────────────────
// 8-08: accepting a suggestion is captured with its real source line item id
// ───────────────────────────────────────────────────────────────────────
describe("recordRateHistoryAcceptance -- 8-08 captures the real source line item id", () => {
  test("writes through logActivity with the source line item id and offered rate in details, inside the same org's transaction", async () => {
    const loggedCalls: Record<string, unknown>[] = []
    const mockLogActivity = mock(async (params: Record<string, unknown>) => {
      loggedCalls.push(params)
    })
    const mockWtc = mock(async (ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => {
      capturedOrgIds.push(ctx.orgId)
      return fn({})
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWtc }))
    await mock.module("@/lib/audit", () => ({ logActivity: mockLogActivity }))

    const { recordRateHistoryAcceptance } = await import("./boq-rate-history-service")
    const dbUser = { id: "user-1", name: "Test User", role: "member" } as unknown as Parameters<
      typeof recordRateHistoryAcceptance
    >[0]["dbUser"]

    await recordRateHistoryAcceptance(
      { orgId: ORG_A, userId: "user-1", dbUser },
      { lineItemId: "new-line-1", sourceLineItemId: "historical-line-9", offeredRate: 85 }
    )

    expect(capturedOrgIds).toEqual([ORG_A])
    expect(loggedCalls).toHaveLength(1)
    const call = loggedCalls[0]!
    expect(call.orgId).toBe(ORG_A)
    expect(call.entityType).toBe("construction_boq_line_item")
    expect(call.entityId).toBe("new-line-1")
    expect(call.action).toBe("boq_rate_history.suggestion_accepted")
    const details = JSON.parse(call.details as string)
    expect(details.sourceLineItemId).toBe("historical-line-9")
    expect(details.offeredRate).toBe(85)
  })
})

// ───────────────────────────────────────────────────────────────────────
// FALSIFIABILITY (this file's own contribution to the PR's required proof):
// this session temporarily deleted the `if (row.orgId !== callingOrgId)`
// branch (and its throw) from buildCandidatesFromRows in
// boq-rate-history-service.ts, re-ran `bun test --isolate
// src/lib/services/boq-rate-history-service.test.ts`, and confirmed the two
// "ADVERSARIAL" tests in the describe block above went RED with a real
// cross-tenant leak (ORG_B's row silently returned to an ORG_A caller,
// instead of the expected throw) -- then reverted the temporary edit
// (`git diff` on boq-rate-history-service.ts was byte-identical to the
// pre-edit committed version) and re-ran, confirming GREEN. Full verbatim
// RED output and the git-diff confirmation are in this PR's description,
// not duplicated here to avoid this comment drifting out of sync with the
// actual run.
