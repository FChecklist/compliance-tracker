/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { TenantDb } from "../db/tenant-scoped"
import type { users } from "../db"

type DbUserRow = typeof users.$inferSelect
const DB_USER = { id: "user-1", orgId: "org-1", role: "admin" } as unknown as DbUserRow

function fakeDb(monitorDef: unknown = { maxExecutionTimeMs: 604_800_000, timeoutMs: 21_600_000, maxRetry: 3, isActive: true }): TenantDb {
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

describe("runBoardMeetingHoldMonitor", () => {
  test("held on the same day as its planned meetingDate reports 'ok'", async () => {
    const { runBoardMeetingHoldMonitor } = await import("./board-meeting-hold-monitor")
    const db = fakeDb()
    const result = await runBoardMeetingHoldMonitor(db, "org-1", { dbUser: DB_USER }, {
      meetingId: "meet-1", title: "Q2 Board Meeting", meetingDate: new Date("2026-07-19T09:00:00.000Z"), heldAt: new Date("2026-07-19T11:00:00.000Z"),
    })
    expect(result.report.status).toBe("ok")
  })

  test("held before its planned meetingDate (early data entry) is never late -- reports 'ok'", async () => {
    const { runBoardMeetingHoldMonitor } = await import("./board-meeting-hold-monitor")
    const db = fakeDb()
    const result = await runBoardMeetingHoldMonitor(db, "org-1", { dbUser: DB_USER }, {
      meetingId: "meet-1", title: "Q2 Board Meeting", meetingDate: new Date("2026-07-20T09:00:00.000Z"), heldAt: new Date("2026-07-19T11:00:00.000Z"),
    })
    expect(result.report.status).toBe("ok")
  })

  test("held weeks after its planned meetingDate reports 'escalate'", async () => {
    const { runBoardMeetingHoldMonitor } = await import("./board-meeting-hold-monitor")
    const db = fakeDb()
    const result = await runBoardMeetingHoldMonitor(db, "org-1", { dbUser: DB_USER }, {
      meetingId: "meet-1", title: "Q2 Board Meeting", meetingDate: new Date("2026-06-01T09:00:00.000Z"), heldAt: new Date("2026-07-19T11:00:00.000Z"),
    })
    expect(result.report.status).toBe("escalate")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })
})
