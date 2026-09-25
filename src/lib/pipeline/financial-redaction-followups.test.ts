/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-01b (2026-09-25): the rest of the construction
// financial-redaction leak that U-01 (financial-redaction.test.ts) left open.
//   B1. api/v1/projexa/tasks and api/v1/projexa/submissions passed
//       ctx.dbUser?.role, always null for PROJEXA's per-org API key, so a
//       named manager was redacted like everyone else. They now share the
//       assistant route's resolveFinancialRole() (lib/supabase/acting-role.ts).
//   B2. task-execution-engine.ts (structured and free-text dispatch) and
//       fde-service.ts called dispatchTool() with no role at all.
//   B3. get_construction_kpi_status, generate_construction_progress_summary and
//       detect_construction_budget_schedule_risk had no financial gate.
// U-01d (2026-09-25, PM decisions D1/D2) adds:
//   D1. resolveFinancialRole() redacts and never refuses: a named person with
//       no active VERIDIAN user gets role null on assistant, tasks and
//       submissions, not the 400 USER_NOT_LINKED U-01/U-01b returned.
//   D2. list_delayed_activities nulls every money field of every row below
//       manager rank; list_over_budget_projects was already refused there and
//       is pinned as found.
//
// WHAT IS FAKED, AND WHAT IS NOT. Faked: the database (@/lib/db's raw client,
// withTenantContext and the rows it reads, the construction read services,
// the instruction cache, the asset registry, the org's model/prompt config and
// the orchestra log) and authentication (requireAuthOrApiKey). The model call
// itself (callLLMJson) is replaced by an echo that repeats what it was shown,
// so a figure the model saw is a figure the answer carries. resolveActingUser,
// resolveFinancialRole, requireRoleOrScope, both route POST functions, the
// pipeline executor, the engine's executeTask, submitFdeRequest, dispatchTool,
// dispatchConstructionTool, generateProgressSummary and
// detectBudgetScheduleRisk all run for real. run-submission.ts is replaced by
// the same kind of stand-in financial-redaction.test.ts uses (see its header):
// each entry point hands the real executeTask exactly the role it was given.
//
// Falsifiability (R74-RULING-03 (c)), checked 2026-09-25 by reverting each
// part alone, running this file, and restoring the bytes:
//   B1 reverted (tasks + submissions back to ctx.dbUser?.role) -> 5 fail;
//   B2 reverted (all three dispatch sites) -> 3 fail, one per site;
//   B3 reverted (construction-tools.ts + construction-ai-service.ts) -> 4 fail;
//     the KPI gate alone -> 1 fail, the summary's redactDashboard alone -> 1
//     fail, withholdBudget alone -> 2 fail.
//   U-01d, same method: D1 reverted (acting-role.ts back to passing
//     USER_NOT_LINKED on, all three routes returning it) -> 7 fail here (the
//     six "no user row" cases and B1's unlinked test) and 1 in
//     financial-redaction.test.ts; the deactivated cases pass either way,
//     since neither was ever refused. D2 reverted (list_delayed_activities
//     back to the bare filter) -> 3 fail here, 1 in assistant/route.test.ts.
import { beforeEach, describe, expect, mock, test } from "bun:test"

const ORG = "org-u01b"
const PROJECT = "p-u01b"

// Stored figures. Over budget on purpose (expenses > budget) so
// list_over_budget_projects has a row to return.
const DASHBOARD = {
  projectId: PROJECT,
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 4_200_000,
  ledgerBudget: 4_000_000,
  revenue: 6_500_000,
  expenses: 5_100_000,
  progressPercent: 41,
  progressByActivityLogPct: 41,
  progressByBoqValuePct: 38,
  delayedTaskCount: 2,
  photoCount: 0,
  taskCount: 10,
  generatedAt: "2026-09-25T00:00:00.000Z",
  projectValue: 6_000_000,
  projectValueSource: "user",
  earnedValue: 2_280_000,
  percentByValue: 38,
  contractValue: 6_000_000,
  permitsExpiringCount: 0,
  permitsExpiredCount: 0,
  categories: [],
  recentEntries: [],
}
const REDACTED_DASHBOARD = {
  ...DASHBOARD,
  budget: null, ledgerBudget: null, revenue: null, expenses: null,
  projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
  progressByBoqValuePct: null,
}
const BUDGET_VS_ACTUAL = { budget: 4_200_000, ledgerBudget: 4_000_000, actual: 5_100_000, variance: -900_000, byHead: [] }
const KPIS = {
  definitions: [
    { id: "k-cost", metricName: "Cost to date", unit: "INR", targetValue: "5000000" },
    { id: "k-margin", metricName: "Gross margin", unit: "%", targetValue: "18" },
    { id: "k-slab", metricName: "Slab work complete", unit: "%", targetValue: "100" },
  ],
  entries: [
    { id: "e-cost", kpiDefinitionId: "k-cost", actualValue: "3900000" },
    { id: "e-margin", kpiDefinitionId: "k-margin", actualValue: "11" },
    { id: "e-slab", kpiDefinitionId: "k-slab", actualValue: "41" },
  ],
}
// U-01d: getOrgDashboard()'s project rows (OrgDashboardProjectSummary), every
// money field filled in. One delayed project, one on schedule, so
// list_delayed_activities has one row to return and one to leave out.
const ORG_PROJECT_DELAYED = {
  id: PROJECT,
  name: "Cedar Heights Villa - Phase 1",
  revenue: 6_500_000,
  expenses: 5_100_000,
  spent: 5_100_000,
  taskCount: 10,
  delayedTaskCount: 2,
  tasksDue: 3,
  tasksLate: 2,
  hasSchedule: true,
  value: 6_000_000,
  budget: 4_200_000,
  ledgerBudget: 4_000_000,
  progressPercent: 41,
  contractValue: 6_000_000,
  projectValue: 6_000_000,
  projectValueSource: "user",
  earnedValue: 2_280_000,
  earnedValuePrevWeek: 2_100_000,
  percentByValue: 38,
  percentByActivity: 41,
  spendOverValue: false,
  permitsExpiring30d: 1,
  lastProgressAt: "2026-09-20",
}
const ORG_PROJECT_ON_SCHEDULE = { ...ORG_PROJECT_DELAYED, id: "p-u01d-on-time", name: "Palm Row Townhouses", delayedTaskCount: 0, tasksLate: 0 }
const ORG_DASHBOARD = {
  totalProjects: 2, totalBudget: 8_400_000, totalLedgerBudget: 8_000_000, totalRevenue: 13_000_000, totalExpenses: 10_200_000,
  dateRangeApplied: false,
  projects: [ORG_PROJECT_DELAYED, ORG_PROJECT_ON_SCHEDULE],
}
const REDACTED_ORG_PROJECT_DELAYED = {
  ...ORG_PROJECT_DELAYED,
  revenue: null, expenses: null, spent: null, budget: null, ledgerBudget: null,
  value: null, contractValue: null, projectValue: null,
  earnedValue: null, earnedValuePrevWeek: null, percentByValue: null, spendOverValue: null,
  financialsRedacted: true,
}
const MONEY = ["4200000", "4000000", "6500000", "5100000", "6000000", "2280000", "900000", "2100000"]
function expectNoMoney(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  for (const figure of MONEY) expect(text).not.toContain(figure)
}

// ── per-test state the fakes read ─────────────────────────────────────────
type UserRow = { id: string; role: string; isActive: boolean; email: string; orgId: string }
let actingUserRow: UserRow | undefined // resolveActingUser's lookup (raw client)
let tenantUserRow: { role: string; isActive: boolean } | undefined // taskOwnerRole's lookup (tenant tx)
let workerAgentRow: Record<string, unknown> | undefined
let authCtx: unknown
let modelConfig: Record<string, unknown> | null
let budgetReads = 0
let projectDashboardReads = 0 // U-01d: list_over_budget_projects' per-project read
const modelInputs: string[] = []
const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = []
const rolesSeen: Array<{ entry: string; role: string | null | undefined }> = []

beforeEach(() => {
  actingUserRow = undefined
  tenantUserRow = undefined
  workerAgentRow = undefined
  authCtx = null
  modelConfig = null
  budgetReads = 0
  projectDashboardReads = 0
  modelInputs.length = 0
  inserted.length = 0
  rolesSeen.length = 0
})

// ── the database ──────────────────────────────────────────────────────────
const realDb = await import("@/lib/db")
mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    execute: mock(async () => []),
    query: { users: { findFirst: mock(async () => actingUserRow) } },
  },
}))

function insertInto(table: unknown) {
  return {
    values(values: Record<string, unknown>) {
      inserted.push({ table, values })
      return Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: `row-${inserted.length}`, ...values }] })
    },
  }
}
const fakeTx = {
  query: {
    users: { findFirst: mock(async () => tenantUserRow) },
    tasks: { findFirst: mock(async () => undefined) },
    workerAgents: {
      findFirst: mock(async () => workerAgentRow),
      findMany: mock(async () => (workerAgentRow ? [workerAgentRow] : [])),
    },
  },
  insert: mock(insertInto),
  update: mock(() => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) })),
}
const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(fakeTx)),
}))

const realDashboardService = await import("@/lib/services/construction-dashboard-service")
mock.module("@/lib/services/construction-dashboard-service", () => ({
  ...realDashboardService,
  getProjectDashboard: mock(async () => ({ ...DASHBOARD })),
  getProjectDashboardsWithDb: mock(async () => { projectDashboardReads += 1; return [{ ...DASHBOARD }] }),
  getProjectDashboards: mock(async () => { projectDashboardReads += 1; return [{ ...DASHBOARD }] }),
  getOrgDashboard: mock(async () => structuredClone(ORG_DASHBOARD)),
  getOrgDashboardWithDb: mock(async () => structuredClone(ORG_DASHBOARD)),
}))

const realReportsService = await import("@/lib/services/construction-reports-service")
mock.module("@/lib/services/construction-reports-service", () => ({
  ...realReportsService,
  budgetVsActual: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
  budgetVsActualWithDb: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
  kpiReport: mock(async () => structuredClone(KPIS)),
  kpiReportWithDb: mock(async () => structuredClone(KPIS)),
}))

const realCache = await import("@/lib/services/instruction-execution-cache-service")
mock.module("@/lib/services/instruction-execution-cache-service", () => ({
  ...realCache,
  findPriorExecutionPath: mock(async () => ({
    resolvedCapabilityType: "worker_agent", resolvedCapabilityId: "agent-over-budget", resolvedLabel: "Over Budget Watch", score: 0.97,
  })),
  recordExecutionPath: mock(async () => undefined),
}))

const realAssetQuery = await import("@/lib/services/asset-query-service")
mock.module("@/lib/services/asset-query-service", () => ({ ...realAssetQuery, queryByKeywords: mock(async () => []) }))

const realPurpose = await import("@/lib/purpose-bound-ai")
mock.module("@/lib/purpose-bound-ai", () => ({ ...realPurpose, resolveOrgDomains: mock(async () => ["construction"]) }))

const realModelResolver = await import("@/lib/orchestra-model-resolver")
mock.module("@/lib/orchestra-model-resolver", () => ({
  ...realModelResolver,
  resolveModelConfig: mock(async () => modelConfig),
  escalatedPlatformConfig: mock(async () => null),
}))
const realMotherRouter = await import("@/lib/ai-router/mother-router")
mock.module("@/lib/ai-router/mother-router", () => ({
  ...realMotherRouter,
  resolveModel: mock(async () => ({ resolvedConfig: modelConfig })),
}))
const realPrompts = await import("@/lib/prompt-os-resolver")
mock.module("@/lib/prompt-os-resolver", () => ({ ...realPrompts, resolvePromptTemplate: mock(async (key: string) => key) }))
const realLogger = await import("@/lib/orchestra-execution-logger")
mock.module("@/lib/orchestra-execution-logger", () => ({ ...realLogger, recordOrchestraExecution: mock(() => undefined) }))

// ── the model: repeats what it was shown ──────────────────────────────────
const realLlm = await import("@/lib/llm-client")
mock.module("@/lib/llm-client", () => ({
  ...realLlm,
  callLLMJson: mock(async (_p: string, _m: string, _k: string, systemPrompt: string, userMessage: string) => {
    modelInputs.push(userMessage)
    const usage = { inputTokens: 1, outputTokens: 1 }
    if (systemPrompt === "task_execution.planning_system") {
      return { data: { summary: "Plan generated.", steps: [{ agentName: "Over Budget Watch", description: "List the projects over budget" }] }, usage }
    }
    if (systemPrompt === "construction.detect_budget_schedule_risk") {
      return { data: { riskLevel: "low", budgetRiskReasoning: `Seen: ${userMessage}`, scheduleRiskReasoning: `Seen: ${userMessage}`, recommendedAction: "Monitor." }, usage }
    }
    return { data: { summary: `Seen: ${userMessage}`, highlights: [], concerns: [] }, usage }
  }),
}))

// ── authentication ────────────────────────────────────────────────────────
const realAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => authCtx),
}))

// ── the run-submission stand-in (see header) ──────────────────────────────
const PHRASE_TO_FUNCTION: Record<string, string> = {
  "show me the budget": "get_construction_budget_status",
  "how is the project doing": "get_construction_project_dashboard",
}
type StandInInput = { orgId: string; userId: string; projectId?: string | null; rawInput?: string; functionId?: string; role?: string | null }
function standIn(entry: string) {
  return mock(async (input: StandInInput) => {
    rolesSeen.push({ entry, role: input.role })
    const functionId = input.functionId ?? PHRASE_TO_FUNCTION[(input.rawInput ?? "").trim().toLowerCase()]
    if (!functionId) throw new Error(`nothing in the test table for ${entry}`)
    const { executeTask } = await import("./executor")
    const outcome = await executeTask({ orgId: input.orgId, userId: input.userId, projectId: input.projectId ?? null, functionId, params: {}, role: input.role })
    const task = outcome.success
      ? { taskId: "task-u01b", functionId, status: "done", result: outcome.result }
      : { taskId: "task-u01b", functionId, status: "blocked", failure: outcome.failure }
    return entry === "confirmSubmission" ? { ok: true, result: { tasks: [task] } } : { submissionId: "sub-u01b", tasks: [task] }
  })
}
mock.module("@/lib/pipeline/run-submission", () => ({
  runSubmission: standIn("runSubmission"),
  runDirectTask: standIn("runDirectTask"),
  proposeSubmission: standIn("proposeSubmission"),
  submitForVerdict: standIn("submitForVerdict"),
  confirmSubmission: standIn("confirmSubmission"),
}))

const { POST: tasksPOST } = await import("@/app/api/v1/projexa/tasks/route")
const { POST: submissionsPOST } = await import("@/app/api/v1/projexa/submissions/route")
const { POST: assistantPOST } = await import("@/app/api/v1/projexa/assistant/route")
const { executeTask: engineExecuteTask } = await import("@/lib/task-execution-engine")
const { submitFdeRequest } = await import("@/lib/services/fde-service")
const { dispatchConstructionTool, FINANCIALS_WITHHELD_SENTENCE } = await import("@/lib/task-execution/construction-tools")
const { taskAgentExecutions } = await import("@/lib/db")

// ── callers ───────────────────────────────────────────────────────────────
type TaskShape = { status: string; result?: unknown; failure?: { code: string } }
const API_KEY_CTX = { orgId: ORG, dbUser: null, apiKey: { id: "key-u01b", name: "PROJEXA org key", scopes: ["read", "write"] }, response: null }
function person(role: string): UserRow {
  return { id: `user-${role}`, role, isActive: true, email: `${role}@example.test`, orgId: ORG }
}

async function post(route: (r: never) => Promise<Response>, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const request = new Request(`https://x/api/v1/projexa/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  const res = await route(request as never)
  const json = (await res.json()) as Record<string, unknown>
  const tasks = (json.tasks as TaskShape[] | undefined) ?? ((json.result as { tasks?: TaskShape[] } | undefined)?.tasks)
  return { status: res.status, body: json, task: tasks?.[0] }
}
const viaTasks = (body: Record<string, unknown>, headers?: Record<string, string>) => post(tasksPOST as never, "tasks", body, headers)
const viaSubmissions = (body: Record<string, unknown>, headers?: Record<string, string>) => post(submissionsPOST as never, "submissions", body, headers)
const viaAssistant = (body: Record<string, unknown>, headers?: Record<string, string>) => post(assistantPOST as never, "assistant", body, headers)

// ── B1: api/v1/projexa/tasks ──────────────────────────────────────────────
describe("U-01b B1 -- api/v1/projexa/tasks with the org API key", () => {
  test("actorEmail naming a member (what PROJEXA's composer sends): the budget is refused and never read", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("member")
    const { status, task } = await viaTasks({ functionId: "get_construction_budget_status", projectId: PROJECT, actorEmail: "member@example.test" })
    expect(status).toBe(201)
    expect(rolesSeen).toEqual([{ entry: "runDirectTask", role: "member" }])
    expect(task?.failure?.code).toBe("INTERNAL_ERROR")
    expect(task?.result).toBeUndefined()
    expect(budgetReads).toBe(0)
  })

  test("actorEmail naming a manager: the budget comes back", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("manager")
    const { status, task } = await viaTasks({ functionId: "get_construction_budget_status", projectId: PROJECT, actorEmail: "manager@example.test" })
    expect(status).toBe(201)
    expect(task?.result).toEqual(BUDGET_VS_ACTUAL)
  })

  test("every POST branch hands the named manager's role to the pipeline", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("manager")
    const named = { projectId: PROJECT, actorEmail: "manager@example.test" }
    await viaTasks({ ...named, rawInput: "show me the budget", dryRun: true })
    await viaTasks({ ...named, confirm: true, submissionId: "sub-1", functionId: "get_construction_budget_status" })
    await viaTasks({ ...named, functionId: "get_construction_budget_status" })
    await viaTasks({ ...named, rawInput: "show me the budget", execute: true })
    const verdict = await viaTasks({ ...named, rawInput: "show me the budget" })
    expect(rolesSeen).toEqual(
      ["proposeSubmission", "confirmSubmission", "runDirectTask", "runSubmission", "submitForVerdict"].map((entry) => ({ entry, role: "manager" }))
    )
    expect(verdict.task?.result).toEqual(BUDGET_VS_ACTUAL)
  })

  test("X-Acting-User naming a member: the project dashboard comes back with every money field null", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("member")
    const { task } = await viaTasks({ functionId: "get_construction_project_dashboard", projectId: PROJECT }, { "x-acting-user": "auth-member" })
    expect(task?.result).toEqual(REDACTED_DASHBOARD)
  })

  test("an API-key call naming nobody is redacted, not refused", async () => {
    authCtx = API_KEY_CTX
    const { status, task } = await viaTasks({ functionId: "get_construction_project_dashboard", projectId: PROJECT })
    expect(status).toBe(201)
    expect(rolesSeen).toEqual([{ entry: "runDirectTask", role: null }])
    expect(task?.result).toEqual(REDACTED_DASHBOARD)
  })

  // U-01d (D1): was "gets the assistant route's 400 USER_NOT_LINKED".
  test("a named actorEmail with no user row is redacted, not refused", async () => {
    authCtx = API_KEY_CTX
    const { status, body, task } = await viaTasks({ functionId: "get_construction_project_dashboard", projectId: PROJECT, actorEmail: "nobody@example.test" })
    expect(status).toBe(201)
    expect(body.code).toBeUndefined()
    expect(rolesSeen).toEqual([{ entry: "runDirectTask", role: null }])
    expect(task?.result).toEqual(REDACTED_DASHBOARD)
  })
})

// ── B1: api/v1/projexa/submissions ────────────────────────────────────────
describe("U-01b B1 -- api/v1/projexa/submissions with the org API key", () => {
  test("a member named by X-Acting-User-Email is refused the budget", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("member")
    const { status, task } = await viaSubmissions({ rawInput: "show me the budget", projectId: PROJECT }, { "x-acting-user-email": "member@example.test" })
    expect(status).toBe(201)
    expect(rolesSeen).toEqual([{ entry: "runSubmission", role: "member" }])
    expect(task?.failure?.code).toBe("INTERNAL_ERROR")
    expect(budgetReads).toBe(0)
  })

  test("a manager named by actorEmail gets the budget and the full dashboard", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("manager")
    expect((await viaSubmissions({ rawInput: "show me the budget", projectId: PROJECT, actorEmail: "manager@example.test" })).task?.result).toEqual(BUDGET_VS_ACTUAL)
    expect((await viaSubmissions({ rawInput: "how is the project doing", projectId: PROJECT, actorEmail: "manager@example.test" })).task?.result).toEqual(DASHBOARD)
  })

  test("an API-key call naming nobody is redacted, not refused", async () => {
    authCtx = API_KEY_CTX
    const { status, task } = await viaSubmissions({ rawInput: "how is the project doing", projectId: PROJECT })
    expect(status).toBe(201)
    expect(rolesSeen).toEqual([{ entry: "runSubmission", role: null }])
    expect(task?.result).toEqual(REDACTED_DASHBOARD)
  })
})

// ── B2: the engine's two dispatch sites, and VERI FDE ─────────────────────
const agent = (codeReference: string) => ({
  id: "agent-u01b", name: "Over Budget Watch", domain: "construction", tier: "global",
  codeReference, lifecycleStatus: "approved", projectId: null,
})
function agentExecution() {
  const row = inserted.find((i) => i.table === taskAgentExecutions)
  if (!row) throw new Error("no task_agent_executions row was written")
  return row.values
}

describe("U-01b B2 -- task-execution-engine.ts structured dispatch (a chain-selected worker agent)", () => {
  const run = () => engineExecuteTask(ORG, "user-owner", "task-1", "Project dashboard for Cedar Heights", null, PROJECT, null, "agent-u01b", undefined, undefined, { projectId: PROJECT })

  test("a manager task owner gets the full dashboard", async () => {
    workerAgentRow = agent("get_construction_project_dashboard")
    tenantUserRow = { role: "manager", isActive: true }
    await run()
    expect(agentExecution().output).toEqual(DASHBOARD)
  })

  test("a member task owner, and a deactivated manager, get every money field null", async () => {
    workerAgentRow = agent("get_construction_project_dashboard")
    tenantUserRow = { role: "member", isActive: true }
    await run()
    expect(agentExecution().output).toEqual(REDACTED_DASHBOARD)

    inserted.length = 0
    tenantUserRow = { role: "manager", isActive: false }
    await run()
    expect(agentExecution().output).toEqual(REDACTED_DASHBOARD)
  })
})

describe("U-01b B2 -- task-execution-engine.ts free-text planning dispatch", () => {
  const run = () => engineExecuteTask(ORG, "user-owner", "task-2", "List the construction projects that are over budget this month", "Check every active project against its BOQ budget.", null, null)

  test("a manager task owner gets the over-budget list", async () => {
    modelConfig = { provider: "openrouter", model: "test-model", apiKey: "test", isCustomerConfigured: true }
    workerAgentRow = agent("list_over_budget_projects")
    tenantUserRow = { role: "manager", isActive: true }
    await run()
    const execution = agentExecution()
    expect(execution.status).toBe("completed")
    expect(execution.output).toEqual([DASHBOARD])
  })

  test("a member task owner is refused it, and no figure is recorded", async () => {
    modelConfig = { provider: "openrouter", model: "test-model", apiKey: "test", isCustomerConfigured: true }
    workerAgentRow = agent("list_over_budget_projects")
    tenantUserRow = { role: "member", isActive: true }
    await run()
    const execution = agentExecution()
    expect(execution.status).toBe("failed")
    expect(execution.errorMessage).toBe("This action requires manager role or higher")
    expectNoMoney(inserted.map((i) => i.values))
  })
})

describe("U-01b B2 -- fde-service.ts auto-dispatch of a matched worker agent", () => {
  const submit = (role: string) =>
    submitFdeRequest(
      { orgId: ORG, userId: `user-${role}`, dbUser: person(role) as never },
      { requestText: "Which construction projects are over budget?" }
    )

  test("a manager requester sees the over-budget list in the answer", async () => {
    workerAgentRow = agent("list_over_budget_projects")
    const record = await submit("manager")
    expect(record?.responseText).toContain(" Result: ")
    expect(record?.responseText).toContain("4200000")
  })

  test("a member requester gets the plain match message, no figures", async () => {
    workerAgentRow = agent("list_over_budget_projects")
    const record = await submit("member")
    expect(record?.responseText).not.toContain(" Result: ")
    expectNoMoney(record?.responseText)
  })
})

// ── B3: the three tools that had no financial gate ────────────────────────
const inputs = { inputs: { projectId: PROJECT } }

describe("U-01b B3 -- get_construction_kpi_status", () => {
  test("member and unknown role: money KPIs lose their values, the rest stay, and the flag is set", async () => {
    for (const role of ["member", undefined, null]) {
      const result = await dispatchConstructionTool(ORG, "user-x", "get_construction_kpi_status", inputs, role, fakeTx as never)
      expect(result).toEqual({
        definitions: [
          { ...KPIS.definitions[0], targetValue: null },
          { ...KPIS.definitions[1], targetValue: null },
          KPIS.definitions[2],
        ],
        entries: [
          { ...KPIS.entries[0], actualValue: null },
          { ...KPIS.entries[1], actualValue: null },
          KPIS.entries[2],
        ],
        financialsRedacted: true,
      })
    }
  })

  test("manager: unchanged, no flag", async () => {
    expect(await dispatchConstructionTool(ORG, "user-x", "get_construction_kpi_status", inputs, "manager", fakeTx as never)).toEqual(KPIS)
  })
})

describe("U-01b B3 -- generate_construction_progress_summary", () => {
  test("member and unknown role: the model never sees a money figure, so the summary has none; progress stays", async () => {
    for (const role of ["member", null]) {
      modelConfig = { provider: "openrouter", model: "test-model", apiKey: "test", isCustomerConfigured: true }
      modelInputs.length = 0
      const result = (await dispatchConstructionTool(ORG, "user-x", "generate_construction_progress_summary", inputs, role, fakeTx as never)) as Record<string, unknown>
      expect(result.financialsRedacted).toBe(true)
      expectNoMoney(modelInputs)
      expectNoMoney(result)
      expect(result.summary).toContain("\"progressPercent\":41")
      expect(result.summary).toContain("\"delayedTaskCount\":2")
    }
  })

  test("manager: the model sees the figures and the summary is returned unchanged", async () => {
    modelConfig = { provider: "openrouter", model: "test-model", apiKey: "test", isCustomerConfigured: true }
    const result = (await dispatchConstructionTool(ORG, "user-x", "generate_construction_progress_summary", inputs, "manager", fakeTx as never)) as Record<string, unknown>
    expect(result).toEqual({ summary: `Seen: ${modelInputs[0]}`, highlights: [], concerns: [] })
    expect(result.summary).toContain("\"budget\":4200000")
  })
})

describe("U-01b B3 -- detect_construction_budget_schedule_risk", () => {
  test("member (no model configured): schedule-only risk, withheld budget sentence, budget never read", async () => {
    const result = await dispatchConstructionTool(ORG, "user-x", "detect_construction_budget_schedule_risk", inputs, "member", fakeTx as never)
    expect(result).toEqual({
      riskLevel: "medium",
      budgetRiskReasoning: FINANCIALS_WITHHELD_SENTENCE,
      scheduleRiskReasoning: "2 of 10 tasks (20%) are delayed.",
      recommendedAction: "Monitor budget and schedule closely over the next reporting period.",
      financialsRedacted: true,
    })
    expect(budgetReads).toBe(0)
  })

  test("unknown role (model configured): the model is shown the task counts only", async () => {
    modelConfig = { provider: "openrouter", model: "test-model", apiKey: "test", isCustomerConfigured: true }
    const result = (await dispatchConstructionTool(ORG, "user-x", "detect_construction_budget_schedule_risk", inputs, undefined, fakeTx as never)) as Record<string, unknown>
    expect(result.financialsRedacted).toBe(true)
    expect(result.budgetRiskReasoning).toBe(FINANCIALS_WITHHELD_SENTENCE)
    expect(result.riskLevel).toBe("medium")
    expectNoMoney(modelInputs)
    expectNoMoney(result)
  })

  test("manager: 'actual X vs budget Y' and the budget-driven risk level are unchanged", async () => {
    const result = await dispatchConstructionTool(ORG, "user-x", "detect_construction_budget_schedule_risk", inputs, "manager", fakeTx as never)
    expect(result).toEqual({
      riskLevel: "high",
      budgetRiskReasoning: "Project is 21% over budget (actual 5100000 vs budget 4200000).",
      scheduleRiskReasoning: "2 of 10 tasks (20%) are delayed.",
      recommendedAction: "Review budget and schedule with the project team immediately.",
    })
    expect(budgetReads).toBe(1)
  })
})

// ── U-01d D1: redact, never refuse ────────────────────────────────────────
// A named person who maps to no active VERIDIAN user (22 of 114 PROJEXA users
// have no linked user) gets the figures redacted and the rest of the answer;
// before U-01d the two "no user row" cases below were a 400 USER_NOT_LINKED.
const deactivatedManager = (): UserRow => ({ ...person("manager"), isActive: false })
const UNRESOLVED_ACTORS: Array<{ label: string; row: () => UserRow | undefined; body: Record<string, unknown>; headers: Record<string, string> }> = [
  { label: "actorEmail with no user row", row: () => undefined, body: { actorEmail: "nobody@example.test" }, headers: {} },
  { label: "X-Acting-User with no user row", row: () => undefined, body: {}, headers: { "x-acting-user": "auth-nobody" } },
  { label: "X-Acting-User naming a deactivated manager", row: deactivatedManager, body: {}, headers: { "x-acting-user": "auth-manager" } },
  { label: "actorEmail naming a deactivated manager", row: deactivatedManager, body: { actorEmail: "manager@example.test" }, headers: {} },
]

describe("U-01d D1 -- a named person with no active VERIDIAN user is redacted, never refused", () => {
  for (const actor of UNRESOLVED_ACTORS) {
    test(`assistant, ${actor.label}: both paths answer, every money field null`, async () => {
      authCtx = API_KEY_CTX
      actingUserRow = actor.row()
      const read = await viaAssistant({ ...actor.body, codeReference: "get_construction_project_dashboard", inputs: { projectId: PROJECT } }, actor.headers)
      expect(read.status).toBe(200)
      expect(read.body).toEqual({ codeReference: "get_construction_project_dashboard", result: REDACTED_DASHBOARD })

      const typed = await viaAssistant({ ...actor.body, rawInput: "how is the project doing", projectId: PROJECT }, actor.headers)
      expect(typed.status).toBe(201)
      expect(rolesSeen).toEqual([{ entry: "runSubmission", role: null }])
      expect(typed.task?.result).toEqual(REDACTED_DASHBOARD)
    })

    test(`tasks, ${actor.label}: 201, the dashboard redacted`, async () => {
      authCtx = API_KEY_CTX
      actingUserRow = actor.row()
      const { status, body, task } = await viaTasks({ ...actor.body, functionId: "get_construction_project_dashboard", projectId: PROJECT }, actor.headers)
      expect(status).toBe(201)
      expect(body.code).toBeUndefined()
      expect(rolesSeen).toEqual([{ entry: "runDirectTask", role: null }])
      expect(task?.result).toEqual(REDACTED_DASHBOARD)
    })

    test(`submissions, ${actor.label}: 201, the dashboard redacted`, async () => {
      authCtx = API_KEY_CTX
      actingUserRow = actor.row()
      const { status, body, task } = await viaSubmissions({ ...actor.body, rawInput: "how is the project doing", projectId: PROJECT }, actor.headers)
      expect(status).toBe(201)
      expect(body.code).toBeUndefined()
      expect(rolesSeen).toEqual([{ entry: "runSubmission", role: null }])
      expect(task?.result).toEqual(REDACTED_DASHBOARD)
    })
  }

  test("a linked, active manager still sees the figures on all three routes", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = person("manager")
    const named = { "x-acting-user-email": "manager@example.test" }
    const read = await viaAssistant({ codeReference: "get_construction_project_dashboard", inputs: { projectId: PROJECT } }, named)
    expect(read.body).toEqual({ codeReference: "get_construction_project_dashboard", result: DASHBOARD })
    expect((await viaAssistant({ rawInput: "how is the project doing", projectId: PROJECT }, named)).task?.result).toEqual(DASHBOARD)
    expect((await viaTasks({ functionId: "get_construction_project_dashboard", projectId: PROJECT }, named)).task?.result).toEqual(DASHBOARD)
    expect((await viaSubmissions({ rawInput: "how is the project doing", projectId: PROJECT }, named)).task?.result).toEqual(DASHBOARD)
    expect(rolesSeen.map((r) => r.role)).toEqual(["manager", "manager", "manager"])
  })
})

// ── U-01d D2: list_delayed_activities, and list_over_budget_projects ──────
describe("U-01d D2 -- list_delayed_activities", () => {
  test("member and unknown role: same rows, every money field null, flag on each row, schedule kept", async () => {
    for (const role of ["member", undefined, null]) {
      const rows = (await dispatchConstructionTool(ORG, "user-x", "list_delayed_activities", undefined, role, fakeTx as never)) as Array<Record<string, unknown>>
      expect(rows).toEqual([REDACTED_ORG_PROJECT_DELAYED])
      expectNoMoney(rows)
      expect(rows[0]).toMatchObject({ name: ORG_PROJECT_DELAYED.name, delayedTaskCount: 2, tasksLate: 2, progressPercent: 41, percentByActivity: 41, financialsRedacted: true })
    }
  })

  test("manager: the rows come back unchanged, no flag", async () => {
    expect(await dispatchConstructionTool(ORG, "user-x", "list_delayed_activities", undefined, "manager", fakeTx as never)).toEqual([ORG_PROJECT_DELAYED])
  })

  test("the assistant route, API key naming nobody: 200 with the redacted rows", async () => {
    authCtx = API_KEY_CTX
    const { status, body } = await viaAssistant({ codeReference: "list_delayed_activities" })
    expect(status).toBe(200)
    expect(body).toEqual({ codeReference: "list_delayed_activities", result: [REDACTED_ORG_PROJECT_DELAYED] })
  })

  test("VERI FDE (no inputs): a member reads the delayed project, not its money; a manager reads both", async () => {
    workerAgentRow = agent("list_delayed_activities")
    const submit = (role: string) =>
      submitFdeRequest({ orgId: ORG, userId: `user-${role}`, dbUser: person(role) as never }, { requestText: "Which projects are running late?" })
    const member = await submit("member")
    expect(member?.responseText).toContain(" Result: ")
    expect(member?.responseText).toContain(ORG_PROJECT_DELAYED.name)
    expect(member?.responseText).toContain("\"financialsRedacted\":true")
    expectNoMoney(member?.responseText)

    const manager = await submit("manager")
    expect(manager?.responseText).toContain("6500000")
    expect(manager?.responseText).not.toContain("financialsRedacted")
  })
})

// list_over_budget_projects needed no change: it was already refused below
// manager rank (the R48 F089 gate, construction-tools.ts), before any
// per-project read. These pin that as found.
describe("U-01d -- list_over_budget_projects, as found", () => {
  test("member and unknown role: refused before any project dashboard is read", async () => {
    for (const role of ["member", undefined, null]) {
      await expect(
        dispatchConstructionTool(ORG, "user-x", "list_over_budget_projects", undefined, role, fakeTx as never)
      ).rejects.toThrow("This action requires manager role or higher")
    }
    expect(projectDashboardReads).toBe(0)
  })

  test("manager: the over-budget projects with their figures", async () => {
    expect(await dispatchConstructionTool(ORG, "user-x", "list_over_budget_projects", undefined, "manager", fakeTx as never)).toEqual([DASHBOARD])
    expect(projectDashboardReads).toBe(1)
  })
})
