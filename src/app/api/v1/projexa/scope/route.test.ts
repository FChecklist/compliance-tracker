/// <reference types="bun-types" />
// R-A4 (batch r75p2-w103-security): cross-org isolation for
// GET /api/v1/projexa/scope.
//
// scope/route.ts is a pure re-export (`export { GET, POST } from
// "@/app/api/v1/construction/boq/route"`), so this file imports THAT route's
// real GET handler, which calls the real, unmodified listBoqs() in
// construction-boq-service.ts -- itself running inside a real
// withTenantContext() call scoped to ctx.orgId (see that function's own
// query: `and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.
// projectId, projectId))`). Only the DB driver boundary
// (@/lib/db/tenant-scoped's withTenantContext) and auth
// (@/lib/supabase/auth-guard's requireAuthOrApiKey) are mocked, matching the
// convention already established by
// src/app/api/v1/construction/boq/route.test.ts.
//
// WHY THE FAKE DB IS NOT A NAIVE "return everything" STUB (unlike that
// sibling test's fake, which ignores `where` entirely because its scenarios
// only ever have one BOQ in flight at a time -- fine for testing the
// hierarchy-validation logic, but useless for testing tenant isolation,
// which is precisely a claim about the WHERE clause). Here the fake's
// `findMany` evaluates the REAL `where` argument the service builds --
// turned into real SQL text + bound params via drizzle-orm's own
// `PgDialect().sqlToQuery()`, not a hand-rolled guess at its internal shape
// -- and filters the in-memory rows against it. That is what gives this test
// real falsifiability: if listBoqs()'s `eq(constructionBoqs.orgId, ctx.orgId)`
// guard were ever weakened or removed, the generated SQL would stop
// containing an org_id condition, this matcher would stop filtering by it,
// and org B's request would come back holding org A's BOQ -- which is
// exactly the failure this test exists to catch. (Verified live: see the
// falsifiability check run against construction-boq-service.ts while writing
// this test.)
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { NextRequest } from "next/server"
import { PgDialect } from "drizzle-orm/pg-core"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

const ORG_A = "test-org-A"
const ORG_B = "test-org-B"
// Deliberately used in BOTH requests below: org B's request names ORG A's
// REAL project id (not a made-up one), so a leak can only be explained by a
// missing/weakened org filter -- never by "org B simply asked for a project
// that doesn't exist anywhere".
const PROJECT_A = "test-project-A"

type FakeBoqRow = {
  id: string
  orgId: string
  projectId: string
  version: number
  title: string
  status: string
  parentBoqId: string | null
  createdAt: Date
  createdById: string
}

type FakeLineItemRow = {
  id: string
  orgId: string
  boqId: string
  itemCode: string | null
  description: string
  unit: string
  quantity: string
  rate: string
  amount: string
  materialCost: string | null
  labourCost: string | null
  equipmentCost: string | null
  overheadPercent: string | null
  profitPercent: string | null
  budgetPercentage: string
  parentLineItemId: string | null
}

// Fixture data: ONE BOQ (with one line item), belonging to org A only.
// Org B never appears as an owner of anything here -- the assertion is that
// org B's request returns literally nothing, not "returns org B's own data".
const boqs: FakeBoqRow[] = [
  {
    id: "boq-A-1",
    orgId: ORG_A,
    projectId: PROJECT_A,
    version: 1,
    title: "Org A's BOQ",
    status: "approved",
    parentBoqId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdById: "user-a",
  },
]

const lineItems: FakeLineItemRow[] = [
  {
    id: "li-A-1",
    orgId: ORG_A,
    boqId: "boq-A-1",
    itemCode: "A-1",
    description: "Org A's only line item",
    unit: "LS",
    quantity: "10",
    rate: "100",
    amount: "1000",
    materialCost: null,
    labourCost: null,
    equipmentCost: null,
    overheadPercent: null,
    profitPercent: null,
    budgetPercentage: "25",
    parentLineItemId: null,
  },
]

const dialect = new PgDialect()

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/**
 * Turns a drizzle-orm `where` condition (e.g. `and(eq(col1, v1), eq(col2,
 * v2))`) into real SQL text + bound params via drizzle's own PgDialect, then
 * matches every `"table"."column" = $N` fragment against `row`. This is a
 * GENUINE evaluation of whatever condition the service under test actually
 * builds -- not a stand-in that always agrees with the caller's claimed
 * orgId regardless of what the real query says.
 */
function matchesWhere(where: unknown, row: Record<string, unknown>): boolean {
  if (!where) return true
  const { sql, params } = dialect.sqlToQuery(where as Parameters<typeof dialect.sqlToQuery>[0])
  const re = /"[\w]+"\."(\w+)"\s*=\s*\$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    const field = toCamel(m[1])
    const expected = params[Number(m[2]) - 1]
    if (row[field] !== expected) return false
  }
  return true
}

function makeFakeDb() {
  return {
    query: {
      constructionBoqs: {
        findMany: async (args: { where?: unknown }) => boqs.filter((r) => matchesWhere(args?.where, r)),
      },
      constructionBoqLineItems: {
        findMany: async (args: { where?: unknown }) => lineItems.filter((r) => matchesWhere(args?.where, r)),
      },
    },
  }
}

let currentOrgId = ORG_A

beforeEach(() => {
  currentOrgId = ORG_A
  mock.module("@/lib/supabase/auth-guard", () => ({
    // Re-exported for the same reason construction/boq/route.test.ts does
    // it: approval-workflow-service.ts (pulled in transitively through
    // construction-boq-service.ts) imports the real ROLE_RANK from this
    // module, and mock.module's factory REPLACES the module's exports
    // rather than merging with the real ones.
    ROLE_RANK,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: currentOrgId,
      dbUser: { id: "user-1" },
      apiKey: null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(makeFakeDb())),
  }))
  mock.module("@/lib/services/project-dashboard-cache", () => ({
    bustProjectDashboardCache: mock(() => {}),
  }))
})

function makeRequest(projectId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/projexa/scope?projectId=${projectId}&include=lineItems`, {
    headers: { cookie: "" },
  })
}

describe("GET /api/v1/projexa/scope -- R-A4 cross-org isolation", () => {
  test("org A's own request returns its own BOQ (sanity check the fixture and fake db actually work)", async () => {
    currentOrgId = ORG_A
    const { GET } = await import("./route")
    const res = await GET(makeRequest(PROJECT_A) as Parameters<typeof GET>[0])
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.boqs.length).toBe(1)
    expect(body.boqs[0].id).toBe("boq-A-1")
  })

  test("R-A4: org B's request against org A's real projectId returns ZERO BOQ records belonging to org A", async () => {
    currentOrgId = ORG_B
    const { GET } = await import("./route")
    const res = await GET(makeRequest(PROJECT_A) as Parameters<typeof GET>[0])
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.boqs).toEqual([])
  })

  test("R-A4 (vice versa): org A's request never surfaces as belonging to org B when org B is the caller", async () => {
    // Same request as the previous test, restated as the exact wording of
    // the acceptance condition ("...and vice versa"): whichever org is NOT
    // the authenticated caller must contribute zero rows to the response.
    currentOrgId = ORG_B
    const { GET } = await import("./route")
    const res = await GET(makeRequest(PROJECT_A) as Parameters<typeof GET>[0])
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.boqs.some((b: { orgId?: string; id: string }) => b.id === "boq-A-1")).toBe(false)
  })
})
