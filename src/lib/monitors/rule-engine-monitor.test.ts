/// <reference types="bun-types" />
// RES-02 Phase 1 (PLATFORM_STRATEGY.md 29.3). Mirrors dispatch-completion-
// monitor.test.ts's discipline: every DB-touching collaborator
// (escalation-ladder.ts's claimEscalation, audit.ts's logActivity) is
// mock.module()'d out, so this suite never opens a live DB connection.
// `db` itself is a plain fake object shaped only as far as
// runRuleEngineMonitor/resolveMonitorDef actually read from it
// (db.query.monitorAgents.findFirst) -- cast through `unknown` to
// TenantDb, the same discipline this repo's other DB-mocked tests use.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { TenantDb } from "../db/tenant-scoped"
import type { users } from "../db"

type DbUserRow = typeof users.$inferSelect

const NOW = new Date("2026-07-19T12:00:00.000Z")

const DB_USER: DbUserRow = {
  id: "user-1",
  name: "Test User",
  email: "user@example.com",
  passwordHash: "x",
  role: "admin",
  avatarUrl: null,
  isActive: true,
  lastLoginAt: null,
  orgId: "org-1",
  departmentId: null,
  onboardingCompleted: true,
  onboardingStage: "profile",
  authUserId: null,
  reportingToId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as DbUserRow

function fakeDb(monitorDef: unknown = null): TenantDb {
  return {
    query: {
      monitorAgents: {
        findFirst: mock(async () => monitorDef),
      },
    },
  } as unknown as TenantDb
}

let claimEscalationMock: ReturnType<typeof mock>
let logActivityMock: ReturnType<typeof mock>

function installMocks() {
  claimEscalationMock = mock(async () => ({
    claimed: true,
    rung: { roleKey: "chief_operating_officer", title: "Chief Operating Officer (COO)", authority: "Performance Monitoring" },
    retryCount: 1,
    nextState: { taskId: "entity-1", ownerRoleKey: "chief_operating_officer", rungIndex: 1, retryCount: 1, lastEscalatedAt: Date.now(), status: "active" },
  }))
  logActivityMock = mock(async () => {})

  mock.module("@/lib/escalation-ladder", () => ({ claimEscalation: claimEscalationMock }))
  mock.module("@/lib/audit", () => ({ logActivity: logActivityMock }))
}

beforeEach(() => {
  installMocks()
})

describe("resolveMonitorDef", () => {
  test("merges real column values over the fallback field-by-field", async () => {
    const { resolveMonitorDef } = await import("./rule-engine-monitor")
    const db = fakeDb({ maxExecutionTimeMs: 1000, timeoutMs: null, maxRetry: null, isActive: false })
    const def = await resolveMonitorDef(db, "some_monitor", { maxExecutionTimeMs: 999, timeoutMs: 2000, maxRetry: 5, isActive: true })
    expect(def).toEqual({ maxExecutionTimeMs: 1000, timeoutMs: 2000, maxRetry: 5, isActive: false })
  })

  test("falls back entirely when no row exists yet", async () => {
    const { resolveMonitorDef, DEFAULT_MONITOR_DEF } = await import("./rule-engine-monitor")
    const db = fakeDb(null)
    const def = await resolveMonitorDef(db, "some_monitor")
    expect(def).toEqual(DEFAULT_MONITOR_DEF)
  })
})

describe("runRuleEngineMonitor", () => {
  test("a satisfied rule reports 'ok' and never calls claimEscalation", async () => {
    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb()
    const result = await runRuleEngineMonitor(db, "org-1", { dbUser: DB_USER }, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "Thing entity-1",
      check: { withinRule: true, protocol: "1 <= 2" },
    })
    expect(result.report.status).toBe("ok")
    expect(result.report.action).toBe("none")
    expect(result.claim).toBeNull()
    expect(claimEscalationMock).not.toHaveBeenCalled()
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  test("a violated rule reports 'escalate' and calls claimEscalation + logActivity", async () => {
    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb()
    const result = await runRuleEngineMonitor(db, "org-1", { dbUser: DB_USER }, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "Thing entity-1",
      check: { withinRule: false, protocol: "5 <= 2" },
    })
    expect(result.report.status).toBe("escalate")
    expect(result.report.action).toBe("escalate")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
    expect(result.claim?.claimed).toBe(true)
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const loggedCall = logActivityMock.mock.calls[0]![0] as { action: string; dbUser?: unknown; apiKey?: unknown }
    expect(loggedCall.action).toBe("monitor.escalation")
    expect(loggedCall.dbUser).toBe(DB_USER)
  })

  test("supports a synthetic system apiKey actor (no human dbUser) exactly like a real Wave 9 API-key-driven write", async () => {
    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb()
    const systemActor = { apiKey: { id: "system:test", name: "System: test" } } as const
    const result = await runRuleEngineMonitor(db, "org-1", systemActor, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "Thing entity-1",
      check: { withinRule: false, protocol: "5 <= 2" },
    })
    expect(result.report.status).toBe("escalate")
    const loggedCall = logActivityMock.mock.calls[0]![0] as { apiKey?: { id: string } }
    expect(loggedCall.apiKey?.id).toBe("system:test")
  })

  test("a worker/protocol string containing junk placeholder text fails validateMonitorReportFields and logs report_invalid instead of escalating", async () => {
    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb()
    const result = await runRuleEngineMonitor(db, "org-1", { dbUser: DB_USER }, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "tbd",
      check: { withinRule: false, protocol: "5 <= 2" },
    })
    expect(result.report.status).toBe("escalate")
    expect(result.claim).toBeNull()
    expect(claimEscalationMock).not.toHaveBeenCalled()
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const loggedCall = logActivityMock.mock.calls[0]![0] as { action: string }
    expect(loggedCall.action).toBe("monitor.report_invalid")
  })

  test("an inactive monitor definition never claims an escalation even when the rule is violated", async () => {
    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb({ maxRetry: 3, timeoutMs: 21_600_000, isActive: false })
    const result = await runRuleEngineMonitor(db, "org-1", { dbUser: DB_USER }, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "Thing entity-1",
      check: { withinRule: false, protocol: "5 <= 2" },
    })
    expect(result.report.status).toBe("escalate")
    expect(result.claim).toBeNull()
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("an escalation claim rejected by the single-owner lock is still logged, not silently dropped", async () => {
    claimEscalationMock = mock(async () => ({
      claimed: false,
      reason: "already_owned_by_other_agent",
      ownerRoleKey: "chief_software_engineering_officer",
      retryCount: 1,
      maxRetry: 3,
    }))
    mock.module("@/lib/escalation-ladder", () => ({ claimEscalation: claimEscalationMock }))

    const { runRuleEngineMonitor } = await import("./rule-engine-monitor")
    const db = fakeDb()
    const result = await runRuleEngineMonitor(db, "org-1", { dbUser: DB_USER }, {
      monitorName: "some_monitor", entityType: "Thing", entityId: "entity-1", worker: "Thing entity-1",
      check: { withinRule: false, protocol: "5 <= 2" },
    })
    expect(result.claim?.claimed).toBe(false)
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const details = (logActivityMock.mock.calls[0]![0] as { details: string }).details
    expect(details).toContain("already owned by chief_software_engineering_officer")
  })
})
