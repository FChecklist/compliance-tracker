/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-01e (2026-09-25): GET /api/construction/dashboard returns
// the same getOrgDashboard() payload as GET /api/v1/projexa/dashboard, and its
// own row list had drifted from the v1 route's: spent, ledgerBudget, value,
// contractValue, projectValue and earnedValuePrevWeek all reached a member.
// The route now applies construction-tools.ts's financialsAllowedForRole() to
// the session user's role and redactOrgProjectFinancials() to every row. Neither
// is mocked here: only requireAuth (the session entry point) and the DB-backed
// dashboard service are faked.
//
// The fixture row carries EVERY field of OrgDashboardProjectSummary (typed
// against it, so a new field fails typecheck here until it is placed in one of
// the two lists), and each test checks every field.
import { describe, test, expect, mock } from "bun:test"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import type { OrgDashboardProjectSummary, OrgDashboardSummary } from "@/lib/services/construction-dashboard-service"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const ROW: OrgDashboardProjectSummary = {
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
  projectValueSource: "purchase_orders",
  earnedValue: 300000,
  earnedValuePrevWeek: 240000,
  percentByValue: 50,
  percentByActivity: 44,
  spendOverValue: true,
  permitsExpiring30d: 2,
  lastProgressAt: "2026-09-01",
}

const MONEY = [
  "revenue", "expenses", "spent", "budget", "ledgerBudget", "value", "contractValue",
  "projectValue", "earnedValue", "earnedValuePrevWeek", "percentByValue", "spendOverValue",
] as const
const NOT_MONEY = [
  "id", "name", "taskCount", "delayedTaskCount", "tasksDue", "tasksLate", "hasSchedule",
  "progressPercent", "projectValueSource", "percentByActivity", "permitsExpiring30d", "lastProgressAt",
] as const

const SUMMARY: OrgDashboardSummary = {
  totalProjects: 1,
  totalBudget: 900000,
  totalLedgerBudget: 250000,
  totalRevenue: 450000,
  totalExpenses: 700000,
  projects: [ROW],
  dateRangeApplied: false,
}

/** The session user's role; null stands for a user row with no role on it. */
let sessionRole: string | null = "manager"

mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuth: mock(async () => ({
    user: { id: "auth-1" },
    dbUser: { id: "u-1", orgId: "org-1", role: sessionRole, isActive: true },
    orgId: "org-1",
    response: null,
  })),
}))

mock.module("@/lib/services/construction-dashboard-service", () => ({
  getOrgDashboard: mock(async () => structuredClone(SUMMARY)),
  ServiceError,
}))

const { GET } = await import("./route")

async function callAs(role: string | null) {
  sessionRole = role
  const res = await GET({ nextUrl: new URL("http://localhost/api/construction/dashboard") } as never)
  return { status: res.status, body: await res.json() }
}

describe("GET /api/construction/dashboard: money withheld below manager rank (U-01e)", () => {
  test("every field of the fixture row is classed as money or not money, exactly once", () => {
    expect([...MONEY, ...NOT_MONEY].sort()).toEqual(Object.keys(ROW).sort())
  })

  const redacted: Array<[string, string | null]> = [
    ["member", "member"],
    ["client_viewer", "client_viewer"],
    ["an unknown role string", "not_a_role"],
    ["no role at all", null],
  ]
  for (const [label, role] of redacted) {
    test(`${label}: every money figure is null, the rows carry financialsRedacted, the rest is unchanged`, async () => {
      const { status, body } = await callAs(role)
      expect(status).toBe(200)
      expect(body.totalBudget).toBeNull()
      expect(body.totalLedgerBudget).toBeNull()
      expect(body.totalRevenue).toBeNull()
      expect(body.totalExpenses).toBeNull()
      expect(body.financialsRedacted).toBe(true)
      expect(body.totalProjects).toBe(1)
      expect(body.dateRangeApplied).toBe(false)
      expect(body.projects).toHaveLength(1)

      const row = body.projects[0]
      for (const field of MONEY) expect({ field, value: row[field] }).toEqual({ field, value: null })
      for (const field of NOT_MONEY) expect({ field, value: row[field] }).toEqual({ field, value: ROW[field] })
      expect(row.financialsRedacted).toBe(true)
      expect(Object.keys(row).sort()).toEqual([...Object.keys(ROW), "financialsRedacted"].sort())
    })
  }

  for (const role of ["manager", "admin"]) {
    test(`${role}: the summary comes back exactly as the service returned it`, async () => {
      const { status, body } = await callAs(role)
      expect(status).toBe(200)
      expect(body).toEqual(SUMMARY)
      expect(body.financialsRedacted).toBeUndefined()
      expect(body.projects[0].financialsRedacted).toBeUndefined()
    })
  }
})
