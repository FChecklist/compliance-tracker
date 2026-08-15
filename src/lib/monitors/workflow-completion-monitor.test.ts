/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { TenantDb } from "../db/tenant-scoped"
import type { users } from "../db"

type DbUserRow = typeof users.$inferSelect
const DB_USER = { id: "user-1", orgId: "org-1", role: "admin" } as unknown as DbUserRow

function fakeDb(monitorDef: unknown = { maxExecutionTimeMs: 86_400_000, timeoutMs: 21_600_000, maxRetry: 3, isActive: true }): TenantDb {
  return { query: { monitorAgents: { findFirst: mock(async () => monitorDef) } } } as unknown as TenantDb
}

let claimEscalationMock: ReturnType<typeof mock>
let logActivityMock: ReturnType<typeof mock>

beforeEach(() => {
  claimEscalationMock = mock(async () => ({
    claimed: true,
    rung: { roleKey: "chief_operating_officer", title: "COO", authority: "Performance Monitoring" },
    retryCount: 1,
  }))
  logActivityMock = mock(async () => {})
  mock.module("@/lib/escalation-ladder", () => ({ claimEscalation: claimEscalationMock }))
  mock.module("@/lib/audit", () => ({ logActivity: logActivityMock }))
})

describe("runWorkflowCompletionMonitor", () => {
  test("an instance completed well within maxExecutionTimeMs reports 'ok'", async () => {
    const { runWorkflowCompletionMonitor } = await import("./workflow-completion-monitor")
    const db = fakeDb()
    const createdAt = new Date("2026-07-19T00:00:00.000Z")
    const completedAt = new Date("2026-07-19T01:00:00.000Z") // 1h, well under 24h SLA
    const result = await runWorkflowCompletionMonitor(db, "org-1", { dbUser: DB_USER }, {
      instanceId: "inst-1", entityType: "erp_payment_entry", entityId: "pay-1", status: "approved", createdAt, completedAt,
    })
    expect(result.report.status).toBe("ok")
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("an instance completed well past maxExecutionTimeMs reports 'escalate'", async () => {
    const { runWorkflowCompletionMonitor } = await import("./workflow-completion-monitor")
    const db = fakeDb()
    const createdAt = new Date("2026-07-01T00:00:00.000Z")
    const completedAt = new Date("2026-07-19T00:00:00.000Z") // 18 days, over 24h SLA
    const result = await runWorkflowCompletionMonitor(db, "org-1", { dbUser: DB_USER }, {
      instanceId: "inst-1", entityType: "erp_payment_entry", entityId: "pay-1", status: "rejected", createdAt, completedAt,
    })
    expect(result.report.status).toBe("escalate")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })
})
