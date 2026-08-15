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

describe("runTaskCompletionMonitor", () => {
  test("a task with no dueDate has no SLA to violate -- always reports 'ok'", async () => {
    const { runTaskCompletionMonitor } = await import("./task-completion-monitor")
    const db = fakeDb()
    const result = await runTaskCompletionMonitor(db, "org-1", { dbUser: DB_USER }, {
      taskId: "task-1", title: "Untitled task", dueDate: null, completedAt: new Date("2026-07-19T00:00:00.000Z"),
    })
    expect(result.report.status).toBe("ok")
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("completed on or before its dueDate reports 'ok'", async () => {
    const { runTaskCompletionMonitor } = await import("./task-completion-monitor")
    const db = fakeDb()
    const result = await runTaskCompletionMonitor(db, "org-1", { dbUser: DB_USER }, {
      taskId: "task-1", title: "On time", dueDate: new Date("2026-07-20T00:00:00.000Z"), completedAt: new Date("2026-07-19T00:00:00.000Z"),
    })
    expect(result.report.status).toBe("ok")
  })

  test("completed after its dueDate reports 'escalate'", async () => {
    const { runTaskCompletionMonitor } = await import("./task-completion-monitor")
    const db = fakeDb()
    const result = await runTaskCompletionMonitor(db, "org-1", { dbUser: DB_USER }, {
      taskId: "task-1", title: "Overdue", dueDate: new Date("2026-07-10T00:00:00.000Z"), completedAt: new Date("2026-07-19T00:00:00.000Z"),
    })
    expect(result.report.status).toBe("escalate")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })
})
