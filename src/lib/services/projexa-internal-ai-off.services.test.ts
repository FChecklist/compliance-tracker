/// <reference types="bun-types" />
// lf-b3-ai-off: each user-facing service call site, with PROJEXA_INTERNAL_AI_ENABLED unset, answers in the shape its screen already
// renders and never reaches the model client -- and with the switch at "1" goes down its old path. The model client (callLLM /
// callLLMJson / callLLMVision) and the model resolver are spies: "never called" is "no model config resolved, no provider reached".
// The database is a small fake (withTenantContext hands the callback a stub `db`), so every "off" case also proves no row was read.
//
//   discussConstruction            off -> 200-shaped {reply: USE_YOUR_OWN_AI}          on -> resolves a model
//   generateProgressSummary        off -> ProjexaInternalAiOffError (403)               on -> resolves a model
//   estimateProgressFromPhoto      off -> ProjexaInternalAiOffError (403)               on -> resolves a model
//   diffDrawingRevisions           off -> ProjexaInternalAiOffError (403)               on -> resolves a model
//   detectBudgetScheduleRisk       off -> templateBudgetScheduleRisk (deterministic)   on -> the model writes the prose
//   generateMeetingIntelligence    off -> ProjexaInternalAiOffError, nothing read      on -> reads the meeting, resolves a model
//   publishVeriMeeting             off -> published, no background model pass queued  on -> the pass is queued (after())
//   ai_recipe report               off -> one "Note" row with USE_YOUR_OWN_AI           on -> the model is asked
//   extractDocumentContent         off -> silent skip                                    on -> resolves a model
//   extractComplianceFields        off -> ProjexaInternalAiOffError                      on -> resolves a model
//
// Run: bun test --isolate src/lib/services/projexa-internal-ai-off.services.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const MODEL = { provider: "openrouter" as const, model: "m", apiKey: "k" }
const resolveModelConfig = mock(async (..._a: unknown[]): Promise<typeof MODEL | null> => MODEL)
const realResolver = await import("@/lib/orchestra-model-resolver")
mock.module("@/lib/orchestra-model-resolver", () => ({ ...realResolver, resolveModelConfig }))

const callLLM = mock(async (..._a: unknown[]) => ({ content: "model reply", usage: { promptTokens: 1, completionTokens: 1 }, durationMs: 1 }))
const callLLMJson = mock(async (..._a: unknown[]) => ({
  data: { summary: "s", riskLevel: "high", budgetRiskReasoning: "model prose", scheduleRiskReasoning: "model prose", recommendedAction: "model prose", columns: ["A"], rows: [{ A: 1 }], keyDecisions: [], suggestedActionItems: [] },
  usage: { promptTokens: 1, completionTokens: 1 },
  durationMs: 1,
}))
const callLLMVision = mock(async (..._a: unknown[]) => ({ content: '{"estimatedPercentComplete":50,"reasoning":"r","confidence":"low"}', usage: { promptTokens: 1, completionTokens: 1 }, durationMs: 1 }))
const realLlm = await import("@/lib/llm-client")
mock.module("@/lib/llm-client", () => ({ ...realLlm, callLLM, callLLMJson, callLLMVision }))

const realPrompts = await import("@/lib/prompt-os-resolver")
mock.module("@/lib/prompt-os-resolver", () => ({ ...realPrompts, resolvePromptTemplate: mock(async () => "system prompt") }))
const realLogger = await import("@/lib/orchestra-execution-logger")
mock.module("@/lib/orchestra-execution-logger", () => ({ ...realLogger, recordOrchestraExecution: mock(() => {}) }))
const realPolicy = await import("@/lib/policy-enforcement-engine")
mock.module("@/lib/policy-enforcement-engine", () => ({ ...realPolicy, enforcePolicy: mock(() => ({ allowed: true })) }))

const DASHBOARD = { projectId: "p1", projectName: "Villa", taskCount: 10, delayedTaskCount: 6 }
const realDashboard = await import("@/lib/services/construction-dashboard-service")
mock.module("@/lib/services/construction-dashboard-service", () => ({
  ...realDashboard,
  getProjectDashboard: mock(async () => DASHBOARD),
  getProjectDashboardsWithDb: mock(async () => [DASHBOARD]),
}))
const realReports = await import("@/lib/services/construction-reports-service")
mock.module("@/lib/services/construction-reports-service", () => ({
  ...realReports,
  budgetVsActual: mock(async () => ({ budget: 100, actual: 150, variance: -50 })),
  budgetVsActualWithDb: mock(async () => ({ budget: 100, actual: 150, variance: -50 })),
}))

// The fake database: every query the services make here, answered from fixtures; every call counted.
const MEETING = { id: "mtg1", orgId: "org-1", title: "Site walk", minutes: "We agreed things.", status: "draft" }
const DEFINITION = { id: "def1", orgId: "org-1", status: "built", classifications: [], executionType: "ai_recipe", executionConfig: { kind: "ai_recipe", promptKey: "k", groundingNote: "n" } }
const fakeDb = {
  query: {
    veriMeetings: { findFirst: async () => MEETING },
    reportDefinitions: { findFirst: async () => DEFINITION },
  },
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ ...MEETING, status: "published" }] }) }) }),
  select: () => ({ from: async () => [] }),
}
const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb))
const realTenant = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenant, withTenantContext }))
const realAudit = await import("@/lib/audit")
mock.module("@/lib/audit", () => ({ ...realAudit, logActivity: mock(async () => {}) }))
const realMonitor = await import("@/lib/monitors/meeting-intelligence-generation-monitor")
mock.module("@/lib/monitors/meeting-intelligence-generation-monitor", () => ({ ...realMonitor, runMeetingIntelligenceGenerationMonitor: mock(async () => {}) }))
const realEnablement = await import("@/lib/services/report-domain-enablement-service")
mock.module("@/lib/services/report-domain-enablement-service", () => ({ ...realEnablement, requireReportDomainEnabled: mock(async () => {}) }))
const afterSpy = mock((_fn: () => unknown) => {})
const realNextServer = await import("next/server")
mock.module("next/server", () => ({ ...realNextServer, after: afterSpy }))

const ai = await import("./construction-ai-service")
const meetings = await import("./veri-meeting-service")
const reports = await import("./report-engine-service")
const extraction = await import("./document-extraction-service")
const { ProjexaInternalAiOffError, USE_YOUR_OWN_AI } = await import("@/lib/projexa-internal-ai")

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED"
const saved = process.env[FLAG]
const ctx = { orgId: "org-1", userId: "user-1" }
const modelCalls = () => resolveModelConfig.mock.calls.length + callLLM.mock.calls.length + callLLMJson.mock.calls.length + callLLMVision.mock.calls.length
beforeEach(() => {
  delete process.env[FLAG]
  for (const s of [resolveModelConfig, callLLM, callLLMJson, callLLMVision, withTenantContext, afterSpy]) s.mockClear()
  resolveModelConfig.mockImplementation(async () => MODEL)
})
afterAll(async () => {
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
  mock.restore()
  for (const [path, real] of [
    ["@/lib/orchestra-model-resolver", realResolver], ["@/lib/llm-client", realLlm], ["@/lib/prompt-os-resolver", realPrompts],
    ["@/lib/orchestra-execution-logger", realLogger], ["@/lib/policy-enforcement-engine", realPolicy],
    ["@/lib/services/construction-dashboard-service", realDashboard], ["@/lib/services/construction-reports-service", realReports],
    ["@/lib/db/tenant-scoped", realTenant], ["@/lib/audit", realAudit], ["@/lib/monitors/meeting-intelligence-generation-monitor", realMonitor],
    ["@/lib/services/report-domain-enablement-service", realEnablement], ["next/server", realNextServer],
  ] as const) await mock.module(path, () => real)
})
const on = () => {
  process.env[FLAG] = "1"
}

describe("construction AI (PROJEXA's Discuss pane and the assistant's AI actions)", () => {
  test("discuss, off: a reply the Discuss pane shows as VERI's message, and no model is touched", async () => {
    expect(await ai.discussConstruction(ctx, "how is the site?")).toEqual({ reply: USE_YOUR_OWN_AI })
    expect(modelCalls()).toBe(0)
  })

  test("discuss, on: the model answers, as before", async () => {
    on()
    expect(await ai.discussConstruction(ctx, "how is the site?")).toEqual({ reply: "model reply" })
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  test("progress summary, off: the refusal, before any model or dashboard read", async () => {
    await expect(ai.generateProgressSummary(ctx, "p1")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(modelCalls()).toBe(0)
  })

  test("progress summary, on: the model is asked, as before", async () => {
    on()
    await ai.generateProgressSummary(ctx, "p1")
    expect(callLLMJson).toHaveBeenCalledTimes(1)
  })

  test("photo progress, off: the refusal (403), no vision call", async () => {
    const error = await ai.estimateProgressFromPhoto({ ...ctx, documentId: "d", imageBase64: "aGk=", mimeType: "image/png", activityName: "Slab" }).catch((e) => e)
    expect(error).toBeInstanceOf(ProjexaInternalAiOffError)
    expect(error.status).toBe(403)
    expect(error.message).toBe(USE_YOUR_OWN_AI)
    expect(modelCalls()).toBe(0)
  })

  test("photo progress, on: the vision model is asked, as before", async () => {
    on()
    await ai.estimateProgressFromPhoto({ ...ctx, documentId: "d", imageBase64: "aGk=", mimeType: "image/png", activityName: "Slab" })
    expect(callLLMVision).toHaveBeenCalledTimes(1)
  })

  test("drawing diff, off: the refusal, no vision call", async () => {
    await expect(ai.diffDrawingRevisions(ctx, { imageBase64A: "a", mimeTypeA: "image/png", imageBase64B: "b", mimeTypeB: "image/png" })).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(modelCalls()).toBe(0)
  })

  test("drawing diff, on: two describes and one diff, as before", async () => {
    on()
    callLLMVision.mockImplementationOnce(async () => ({ content: "{}", usage: { promptTokens: 1, completionTokens: 1 }, durationMs: 1 }))
    callLLMVision.mockImplementationOnce(async () => ({ content: "{}", usage: { promptTokens: 1, completionTokens: 1 }, durationMs: 1 }))
    await ai.diffDrawingRevisions(ctx, { imageBase64A: "a", mimeTypeA: "image/png", imageBase64B: "b", mimeTypeB: "image/png" })
    expect(callLLMVision).toHaveBeenCalledTimes(2)
    expect(callLLMJson).toHaveBeenCalledTimes(1)
  })

  test("budget/schedule risk, off: the deterministic template (riskLevel from the formula), no model", async () => {
    const risk = await ai.detectBudgetScheduleRisk(ctx, "p1")
    expect(modelCalls()).toBe(0)
    expect(risk.riskLevel).toBe(ai.classifyBudgetScheduleRisk({ budget: 100, actual: 150, variance: -50, delayedTaskCount: 6, totalTaskCount: 10 }))
    expect(risk.budgetRiskReasoning).not.toBe("model prose")
    expect(risk.recommendedAction.length).toBeGreaterThan(0)
  })

  test("budget/schedule risk, on: the model writes the prose, as before", async () => {
    on()
    const risk = await ai.detectBudgetScheduleRisk(ctx, "p1")
    expect(callLLMJson).toHaveBeenCalledTimes(1)
    expect(risk.budgetRiskReasoning).toBe("model prose")
  })
})

describe("meeting minutes intelligence", () => {
  const mctx = { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1", orgId: "org-1", role: "manager" } } as unknown as Parameters<typeof meetings.generateMeetingIntelligence>[0]

  test("generate, off: the refusal before the meeting is even read", async () => {
    await expect(meetings.generateMeetingIntelligence(mctx, "mtg1")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(withTenantContext).not.toHaveBeenCalled()
    expect(modelCalls()).toBe(0)
  })

  test("generate, on: reads the meeting and resolves a model, as before", async () => {
    on()
    resolveModelConfig.mockImplementation(async () => null) // stop at the old "no provider" refusal: past the switch, short of a write
    await expect(meetings.generateMeetingIntelligence(mctx, "mtg1")).rejects.toThrow("No AI provider configured")
    expect(resolveModelConfig).toHaveBeenCalledTimes(1)
  })

  test("publish, off: published and locked, and no background model pass is queued", async () => {
    const row = await meetings.publishVeriMeeting(mctx, "mtg1")
    expect(row?.status).toBe("published")
    expect(afterSpy).not.toHaveBeenCalled()
  })

  test("publish, on: the background pass is queued, as before", async () => {
    on()
    await meetings.publishVeriMeeting(mctx, "mtg1")
    expect(afterSpy).toHaveBeenCalledTimes(1)
  })
})

describe("ai_recipe reports", () => {
  test("off: one Note row carrying USE_YOUR_OWN_AI (the engine's own refusal shape), no model", async () => {
    const result = await reports.executeReportDefinition(ctx, "def1", { groundingData: { rows: [{ a: 1 }] } })
    expect(result).toEqual({ columns: ["Note"], rows: [{ Note: USE_YOUR_OWN_AI }] })
    expect(modelCalls()).toBe(0)
  })

  test("on: the model is asked, as before", async () => {
    on()
    const result = await reports.executeReportDefinition(ctx, "def1", { groundingData: { rows: [{ a: 1 }] } })
    expect(callLLMJson).toHaveBeenCalledTimes(1)
    expect(result.columns).toEqual(["A"])
  })
})

describe("document extraction (background enrichment and the compliance-fields read)", () => {
  const doc = { ...ctx, documentId: "d", fileBase64: "aGk=", mimeType: "image/png" }

  test("extractDocumentContent, off: a silent skip -- no model resolved, no row touched", async () => {
    await expect(extraction.extractDocumentContent(doc)).resolves.toBeUndefined()
    expect(modelCalls()).toBe(0)
    expect(withTenantContext).not.toHaveBeenCalled()
  })

  test("extractDocumentContent, on: resolves a model, as before", async () => {
    on()
    resolveModelConfig.mockImplementation(async () => null)
    await extraction.extractDocumentContent(doc)
    expect(resolveModelConfig).toHaveBeenCalledTimes(1)
  })

  test("extractComplianceFields, off: the refusal, no model", async () => {
    await expect(extraction.extractComplianceFields("org-1", "notice text")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(modelCalls()).toBe(0)
  })

  test("extractComplianceFields, on: the model is asked, as before", async () => {
    on()
    await extraction.extractComplianceFields("org-1", "notice text")
    expect(callLLMJson).toHaveBeenCalledTimes(1)
  })
})
