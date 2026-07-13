/// <reference types="bun-types" />
// PLATFORM_STRATEGY.md 29.3 Phase 1+2 / 31.4 Phase B. Mirrors connector-
// data-service.test.ts's discipline: the one real model call
// (resolvePlatformModelConfig + callLLMJson) and every DB-touching
// collaborator (escalation-ladder.ts's claimEscalation, audit.ts's
// logActivity, prompt-os-resolver.ts's resolvePromptTemplate) are
// mock.module()'d out, so this suite never opens a live DB connection or
// makes a real network call. `db` itself is a plain fake object shaped
// only as far as runDispatchCompletionMonitor actually reads from it
// (db.query.monitorAgents.findFirst) -- cast through `unknown` to TenantDb,
// the same discipline this repo's other DB-mocked tests use.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { TenantDb } from "../db/tenant-scoped"
import type { activityLog, users } from "../db"

type StuckActivityRow = typeof activityLog.$inferSelect
type DbUserRow = typeof users.$inferSelect

const NOW = new Date("2026-07-13T12:00:00.000Z")

function buildActivity(overrides: Partial<StuckActivityRow> = {}): StuckActivityRow {
  return {
    id: "act-1",
    orgId: "org-1",
    clientId: null,
    userId: "user-1",
    activityType: "ai_team_dispatch",
    detailTable: null,
    detailId: null,
    lifecycleStage: "executing",
    objective: "Add real PDF export to the reports dashboard",
    selfAssessment: null,
    reviewedBy: null,
    reviewNotes: null,
    reviewDecision: null,
    roleKey: "governance_backend_engineer",
    durationMs: null,
    errorReason: null,
    riskLevel: null,
    confidencePercentage: null,
    confidenceBand: null,
    complexityTier: "integrative",
    reAuditRequestedAt: null,
    reAuditReason: null,
    reAuditRequestedBy: null,
    executiveReviewedAt: null,
    executiveReviewedBy: null,
    executiveReviewNotes: null,
    createdAt: new Date(NOW.getTime() - 40 * 60 * 60 * 1000),
    updatedAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000),
    ...overrides,
  } as StuckActivityRow
}

const DB_USER: DbUserRow = {
  id: "admin-1",
  name: "Test Admin",
  email: "admin@example.com",
  passwordHash: "x",
  role: "veridian_admin",
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

// ─── Collaborator mocks, reset before every test ──────────────────────────

let claimEscalationMock: ReturnType<typeof mock>
let logActivityMock: ReturnType<typeof mock>
let resolvePlatformModelConfigMock: ReturnType<typeof mock>
let callLLMJsonMock: ReturnType<typeof mock>

function installMocks() {
  claimEscalationMock = mock(async () => ({
    claimed: true,
    rung: { roleKey: "chief_operating_officer", title: "Chief Operating Officer (COO)", authority: "Performance Monitoring" },
    retryCount: 1,
    nextState: { taskId: "act-1", ownerRoleKey: "chief_operating_officer", rungIndex: 1, retryCount: 1, lastEscalatedAt: Date.now(), status: "active" },
  }))
  logActivityMock = mock(async () => {})
  resolvePlatformModelConfigMock = mock(async () => ({
    provider: "groq", model: "openai/gpt-oss-120b", apiKey: "test-key", isCustomerConfigured: false, fallback: undefined,
  }))
  callLLMJsonMock = mock(async () => ({ data: {}, usage: { promptTokens: 10, completionTokens: 10 } }))

  mock.module("@/lib/escalation-ladder", () => ({ claimEscalation: claimEscalationMock }))
  mock.module("@/lib/audit", () => ({ logActivity: logActivityMock }))
  mock.module("@/lib/orchestra-model-resolver", () => ({ resolvePlatformModelConfig: resolvePlatformModelConfigMock }))
  mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))
  mock.module("@/lib/prompt-os-resolver", () => ({ resolvePromptTemplate: mock(async () => "system prompt") }))
}

beforeEach(() => {
  installMocks()
})

describe("describeStuckDispatch", () => {
  test("renders real fields and marks unrecorded ones explicitly rather than guessing", async () => {
    const { describeStuckDispatch } = await import("./dispatch-completion-monitor")
    const text = describeStuckDispatch(buildActivity({ selfAssessment: null }))
    expect(text).toContain("Lifecycle stage (non-terminal -- this dispatch is stuck here): executing")
    expect(text).toContain("Objective: Add real PDF export to the reports dashboard")
    expect(text).toContain("Self-reported handover: none recorded")
  })

  test("includes the self-reported handover JSON verbatim when present", async () => {
    const { describeStuckDispatch } = await import("./dispatch-completion-monitor")
    const selfAssessment = { taskStatus: "In progress", validationPassed: "partial" }
    const text = describeStuckDispatch(buildActivity({ selfAssessment }))
    expect(text).toContain('"taskStatus":"In progress"')
  })
})

describe("runDispatchCompletionMonitor", () => {
  test("a clearly-complete dispatch reports 'ok' and never calls claimEscalation", async () => {
    callLLMJsonMock = mock(async () => ({
      data: {
        status: "ok",
        worker: "ActivityLog act-1 (ai_team_dispatch, stage=executing, role=governance_backend_engineer)",
        protocol: "dispatch_completion_monitor: real handover with validationPassed=yes found, consistent with stage",
        confidence: 90,
        action: "none",
      },
      usage: { promptTokens: 10, completionTokens: 10 },
    }))
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity({ selfAssessment: { taskStatus: "Completed", validationPassed: "yes" } })

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("ok")
    expect(result.reportValid).toBe(true)
    expect(result.modelCallFailed).toBe(false)
    expect(result.claim).toBeNull()
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("a clearly-stuck dispatch reports 'escalate' and calls claimEscalation", async () => {
    callLLMJsonMock = mock(async () => ({
      data: {
        status: "escalate",
        worker: "ActivityLog act-1 (ai_team_dispatch, stage=executing, role=governance_backend_engineer)",
        protocol: "dispatch_completion_monitor: no self-reported handover after 30h in stage=executing",
        confidence: 85,
        action: "escalate",
      },
      usage: { promptTokens: 10, completionTokens: 10 },
    }))
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity({ selfAssessment: null })

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("escalate")
    expect(result.reportValid).toBe(true)
    expect(result.modelCallFailed).toBe(false)
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
    expect(result.claim?.claimed).toBe(true)
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const loggedCall = logActivityMock.mock.calls[0]![0] as { action: string }
    expect(loggedCall.action).toBe("monitor.escalation")
  })

  test("malformed model output (missing required fields) fails closed to escalate, not a silent pass", async () => {
    callLLMJsonMock = mock(async () => ({
      data: { status: "ok" }, // missing worker/protocol/confidence/action -- malformed
      usage: { promptTokens: 5, completionTokens: 5 },
    }))
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity()

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("escalate")
    expect(result.reportValid).toBe(false)
    expect(result.modelCallFailed).toBe(false)
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
    expect(logActivityMock).toHaveBeenCalledTimes(2) // report_invalid + escalation
    const actions = logActivityMock.mock.calls.map((c) => (c[0] as { action: string }).action)
    expect(actions).toContain("monitor.report_invalid")
    expect(actions).toContain("monitor.escalation")
  })

  test("a model call that throws (e.g. network/HTTP failure) also fails closed to escalate", async () => {
    callLLMJsonMock = mock(async () => { throw new Error("simulated network failure") })
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity()

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("escalate")
    expect(result.reportValid).toBe(false)
    expect(result.modelCallFailed).toBe(true)
    expect(result.report.protocol).toContain("model call failed")
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })

  test("no platform model configured also fails closed to escalate (never silently 'ok')", async () => {
    resolvePlatformModelConfigMock = mock(async () => null)
    mock.module("@/lib/orchestra-model-resolver", () => ({ resolvePlatformModelConfig: resolvePlatformModelConfigMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity()

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("escalate")
    expect(result.modelCallFailed).toBe(true)
    expect(callLLMJsonMock).not.toHaveBeenCalled()
    expect(claimEscalationMock).toHaveBeenCalledTimes(1)
  })

  test("an inactive monitor definition logs the invalid/escalate report but never claims an escalation", async () => {
    callLLMJsonMock = mock(async () => ({
      data: {
        status: "escalate", worker: "ActivityLog act-1", protocol: "dispatch_completion_monitor: no handover found",
        confidence: 80, action: "escalate",
      },
      usage: { promptTokens: 5, completionTokens: 5 },
    }))
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb({ maxRetry: 3, timeoutMs: 21_600_000, isActive: false })
    const activity = buildActivity()

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("escalate")
    expect(result.claim).toBeNull()
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })

  test("status/action casing from the model is normalized before being acted on", async () => {
    callLLMJsonMock = mock(async () => ({
      data: {
        status: "OK", worker: "ActivityLog act-1 (ai_team_dispatch)", protocol: "dispatch_completion_monitor: real handover found",
        confidence: 95, action: "NONE",
      },
      usage: { promptTokens: 5, completionTokens: 5 },
    }))
    mock.module("@/lib/llm-client", () => ({ callLLMJson: callLLMJsonMock }))

    const { runDispatchCompletionMonitor } = await import("./dispatch-completion-monitor")
    const db = fakeDb()
    const activity = buildActivity()

    const result = await runDispatchCompletionMonitor(db, "org-1", DB_USER, activity)

    expect(result.report.status).toBe("ok")
    expect(result.report.action).toBe("none")
    expect(claimEscalationMock).not.toHaveBeenCalled()
  })
})
