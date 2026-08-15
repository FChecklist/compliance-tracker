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

describe("runMeetingIntelligenceGenerationMonitor", () => {
  test("a successful generation attempt reports 'ok' and never escalates", async () => {
    const { runMeetingIntelligenceGenerationMonitor } = await import("./meeting-intelligence-generation-monitor")
    const db = fakeDb()
    const result = await runMeetingIntelligenceGenerationMonitor(db, "org-1", { dbUser: DB_USER }, {
      meetingId: "meet-1", title: "Q2 Board Sync", succeeded: true,
    })
    expect(result.report.status).toBe("ok")
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("a failed generation attempt reports 'escalate' with the real failure reason in the protocol string", async () => {
    const { runMeetingIntelligenceGenerationMonitor } = await import("./meeting-intelligence-generation-monitor")
    const db = fakeDb()
    const result = await runMeetingIntelligenceGenerationMonitor(db, "org-1", { dbUser: DB_USER }, {
      meetingId: "meet-1", title: "Q2 Board Sync", succeeded: false, failureReason: "No AI provider configured for this organisation",
    })
    expect(result.report.status).toBe("escalate")
    expect(result.report.protocol).toContain("No AI provider configured for this organisation")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })
})
