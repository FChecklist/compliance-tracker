/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { TenantDb } from "../db/tenant-scoped"

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

describe("runWebhookDeliveryOutcomeMonitor", () => {
  test("a successful delivery reports 'ok' via the synthetic system actor, never a human dbUser", async () => {
    const { runWebhookDeliveryOutcomeMonitor } = await import("./webhook-delivery-outcome-monitor")
    const db = fakeDb()
    const result = await runWebhookDeliveryOutcomeMonitor(db, "org-1", {
      webhookId: "hook-1", eventType: "task.completed", succeeded: true, attempts: 1, lastStatusCode: 200,
    })
    expect(result.report.status).toBe("ok")
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("a delivery that exhausted all retries reports 'escalate' and logs the synthetic system apiKey actor", async () => {
    const { runWebhookDeliveryOutcomeMonitor } = await import("./webhook-delivery-outcome-monitor")
    const db = fakeDb()
    const result = await runWebhookDeliveryOutcomeMonitor(db, "org-1", {
      webhookId: "hook-1", eventType: "task.completed", succeeded: false, attempts: 3, lastStatusCode: 500,
    })
    expect(result.report.status).toBe("escalate")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
    const loggedCall = logActivityMock.mock.calls[0]![0] as { apiKey?: { id: string } }
    expect(loggedCall.apiKey?.id).toBe("system:webhook-deliver")
  })
})
