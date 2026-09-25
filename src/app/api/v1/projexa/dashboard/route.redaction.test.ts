/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-01e (2026-09-25): GET /api/v1/projexa/dashboard withholds
// every money figure from a caller whose role is unknown or below manager rank,
// on BOTH of its shapes:
//   - the org summary: each project row used to keep projectValue;
//   - ?projectIds= (the batch): each row used to keep ledgerBudget and
//     progressByBoqValuePct.
// The route now applies construction-tools.ts's financialsAllowedForRole(),
// redactOrgProjectFinancials() and redactProjectDashboardFinancials(), with the
// role from acting-role.ts's resolveFinancialRole(). None of those is mocked
// here: only the auth entry point (requireAuthOrApiKey), the acting-person DB
// lookup (resolveActingUser) and the DB-backed dashboard service are faked.
//
// Each fixture row carries EVERY field of its service type (typed against it,
// so a new field fails typecheck here until it is placed in one of the two
// lists), and each test checks every field: a money field null, every other
// field exactly as the service returned it.
import { describe, test, expect, mock } from "bun:test"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import type {
  OrgDashboardProjectSummary,
  OrgDashboardSummary,
  ProjectDashboard,
} from "@/lib/services/construction-dashboard-service"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const ORG_ROW: OrgDashboardProjectSummary = {
  id: "p-1",
  name: "Cedar Heights Villa",
  revenue: 450000,
  expenses: 700000,
  spent: 700000,
  taskCount: 12,
  delayedTaskCount: 3,
  tasksDue: 5,
  tasksLate: 3,
  hasSchedule: true,
  value: 600000,
  budget: 900000,
  ledgerBudget: 250000,
  progressPercent: 46,
  contractValue: 600000,
  projectValue: 1200000,
  projectValueSource: "entered",
  earnedValue: 300000,
  earnedValuePrevWeek: 240000,
  percentByValue: 50,
  percentByActivity: 44,
  spendOverValue: true,
  permitsExpiring30d: 2,
  lastProgressAt: "2026-09-01",
}

const ORG_ROW_MONEY = [
  "revenue", "expenses", "spent", "budget", "ledgerBudget", "value", "contractValue",
  "projectValue", "earnedValue", "earnedValuePrevWeek", "percentByValue", "spendOverValue",
] as const
const ORG_ROW_NOT_MONEY = [
  "id", "name", "taskCount", "delayedTaskCount", "tasksDue", "tasksLate", "hasSchedule",
  "progressPercent", "projectValueSource", "percentByActivity", "permitsExpiring30d", "lastProgressAt",
] as const

const SUMMARY: OrgDashboardSummary = {
  totalProjects: 1,
  totalBudget: 900000,
  totalLedgerBudget: 250000,
  totalRevenue: 450000,
  totalExpenses: 700000,
  projects: [ORG_ROW],
  dateRangeApplied: false,
}

const DASHBOARD: ProjectDashboard = {
  projectId: "p-1",
  projectName: "Oakwood",
  budget: 100000,
  ledgerBudget: 80000,
  revenue: 200000,
  expenses: 50000,
  progressPercent: 60,
  progressByActivityLogPct: 60,
  progressByBoqValuePct: 20,
  delayedTaskCount: 1,
  photoCount: 7,
  taskCount: 4,
  generatedAt: "2026-09-25T06:00:00.000Z",
  projectValue: 300000,
  projectValueSource: "purchase_orders",
  earnedValue: 40000,
  percentByValue: 20,
  contractValue: 200000,
  permitsExpiringCount: 1,
  permitsExpiredCount: 0,
  categories: [{ categoryId: "c-1", name: "Civil", percentComplete: 60 }],
  recentEntries: [
    { id: "e-1", activityId: "a-1", activityName: "Slab", entryDate: "2026-09-24", quantityDone: "12", percentComplete: "60" },
  ],
}

const DASHBOARD_MONEY = [
  "budget", "ledgerBudget", "revenue", "expenses", "projectValue", "earnedValue",
  "percentByValue", "contractValue", "progressByBoqValuePct",
] as const
const DASHBOARD_NOT_MONEY = [
  "projectId", "projectName", "progressPercent", "progressByActivityLogPct", "delayedTaskCount",
  "photoCount", "taskCount", "generatedAt", "projectValueSource", "permitsExpiringCount",
  "permitsExpiredCount", "categories", "recentEntries",
] as const

// ─── fakes: auth entry point, acting-person lookup, dashboard service ───

type Caller =
  | { kind: "session"; role: string }
  | { kind: "apiKey"; headers: Record<string, string> }

let caller: Caller = { kind: "session", role: "manager" }

/** The people resolveActingUser() knows in this org, by the email PROJEXA sends. */
const ORG_PEOPLE: Record<string, string> = {
  "site.engineer@example.com": "member",
  "client@example.com": "client_viewer",
  "pm@example.com": "manager",
}

const resolveActingUser = mock(async (_ctx: unknown, actorEmail?: string | null) => {
  const role = actorEmail ? ORG_PEOPLE[actorEmail] : undefined
  if (role) return { user: { id: `u-${role}`, role, isActive: true }, error: null }
  return {
    user: null,
    error: Response.json({ error: realAuthGuard.USER_NOT_LINKED_MESSAGE, code: "USER_NOT_LINKED" }, { status: 400 }),
  }
})

mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({
    orgId: "org-1",
    dbUser: caller.kind === "session" ? { id: "u-session", role: caller.role, isActive: true } : null,
    apiKey: caller.kind === "apiKey" ? { id: "key-1", name: "PROJEXA", scopes: ["read", "write"] } : null,
    response: null,
  })),
  resolveActingUser,
}))

mock.module("@/lib/services/construction-dashboard-service", () => ({
  getOrgDashboard: mock(async () => structuredClone(SUMMARY)),
  getProjectDashboards: mock(async () => [structuredClone(DASHBOARD)]),
  ServiceError,
}))

const { GET } = await import("./route")

async function call(search: string, headers: Record<string, string> = {}) {
  const res = await GET({
    nextUrl: new URL(`http://localhost/api/v1/projexa/dashboard${search}`),
    headers: new Headers(headers),
  } as never)
  return { status: res.status, body: await res.json() }
}

function callAs(c: Caller, search: string) {
  caller = c
  resolveActingUser.mockClear()
  return call(search, c.kind === "apiKey" ? c.headers : {})
}

// ─── assertions ───

function expectOrgRowRedacted(row: Record<string, unknown>) {
  for (const field of ORG_ROW_MONEY) expect({ field, value: row[field] }).toEqual({ field, value: null })
  for (const field of ORG_ROW_NOT_MONEY) expect({ field, value: row[field] }).toEqual({ field, value: ORG_ROW[field] })
  expect(row.financialsRedacted).toBe(true)
  expect(Object.keys(row).sort()).toEqual([...Object.keys(ORG_ROW), "financialsRedacted"].sort())
}

function expectDashboardRedacted(row: Record<string, unknown>) {
  for (const field of DASHBOARD_MONEY) expect({ field, value: row[field] }).toEqual({ field, value: null })
  for (const field of DASHBOARD_NOT_MONEY) expect({ field, value: row[field] }).toEqual({ field, value: DASHBOARD[field] })
  expect(row.financialsRedacted).toBe(true)
  expect(Object.keys(row).sort()).toEqual([...Object.keys(DASHBOARD), "financialsRedacted"].sort())
}

const REDACTED_CALLERS: Array<[string, Caller]> = [
  ["a session member", { kind: "session", role: "member" }],
  ["an API-key caller acting as a member", { kind: "apiKey", headers: { "x-acting-user-email": "site.engineer@example.com" } }],
  ["an API-key caller acting as a client_viewer", { kind: "apiKey", headers: { "x-acting-user-email": "client@example.com" } }],
  ["an API-key caller naming nobody (role unknown)", { kind: "apiKey", headers: {} }],
  ["an API-key caller naming an unlinked person (role unknown)", { kind: "apiKey", headers: { "x-acting-user-email": "nobody@example.com" } }],
]

const MANAGER_CALLERS: Array<[string, Caller]> = [
  ["a session manager", { kind: "session", role: "manager" }],
  ["a session admin", { kind: "session", role: "admin" }],
  ["an API-key caller acting as a manager", { kind: "apiKey", headers: { "x-acting-user-email": "pm@example.com" } }],
]

describe("U-01e fixtures", () => {
  test("every field of each fixture row is classed as money or not money, exactly once", () => {
    expect([...ORG_ROW_MONEY, ...ORG_ROW_NOT_MONEY].sort()).toEqual(Object.keys(ORG_ROW).sort())
    expect([...DASHBOARD_MONEY, ...DASHBOARD_NOT_MONEY].sort()).toEqual(Object.keys(DASHBOARD).sort())
  })
})

describe("GET /api/v1/projexa/dashboard (org summary): money withheld below manager rank (U-01e)", () => {
  for (const [label, c] of REDACTED_CALLERS) {
    test(`${label}: every money figure is null, the rows carry financialsRedacted, the rest is unchanged`, async () => {
      const { status, body } = await callAs(c, "")
      expect(status).toBe(200)
      expect(body.totalBudget).toBeNull()
      expect(body.totalLedgerBudget).toBeNull()
      expect(body.totalRevenue).toBeNull()
      expect(body.totalExpenses).toBeNull()
      expect(body.financialsRedacted).toBe(true)
      expect(body.totalProjects).toBe(1)
      expect(body.dateRangeApplied).toBe(false)
      expect(body.projects).toHaveLength(1)
      expectOrgRowRedacted(body.projects[0])
    })
  }

  for (const [label, c] of MANAGER_CALLERS) {
    test(`${label}: the summary comes back exactly as the service returned it`, async () => {
      const { status, body } = await callAs(c, "")
      expect(status).toBe(200)
      expect(body).toEqual(SUMMARY)
      expect(body.financialsRedacted).toBeUndefined()
      expect(body.projects[0].financialsRedacted).toBeUndefined()
    })
  }

  test("an API-key caller's role is the acting person's, read from the X-Acting-User-Email header", async () => {
    await callAs({ kind: "apiKey", headers: { "x-acting-user-email": "site.engineer@example.com" } }, "")
    expect(resolveActingUser).toHaveBeenCalledTimes(1)
    expect(resolveActingUser.mock.calls[0][1]).toBe("site.engineer@example.com")
  })
})

describe("GET /api/v1/projexa/dashboard?projectIds= (batch): money withheld below manager rank (U-01e)", () => {
  for (const [label, c] of REDACTED_CALLERS) {
    test(`${label}: every money figure is null, each row carries financialsRedacted, the rest is unchanged`, async () => {
      const { status, body } = await callAs(c, "?projectIds=p-1")
      expect(status).toBe(200)
      expect(Object.keys(body)).toEqual(["dashboards"])
      expect(body.dashboards).toHaveLength(1)
      expectDashboardRedacted(body.dashboards[0])
    })
  }

  for (const [label, c] of MANAGER_CALLERS) {
    test(`${label}: the dashboards come back exactly as the service returned them`, async () => {
      const { status, body } = await callAs(c, "?projectIds=p-1")
      expect(status).toBe(200)
      expect(body).toEqual({ dashboards: [DASHBOARD] })
      expect(body.dashboards[0].financialsRedacted).toBeUndefined()
    })
  }
})
