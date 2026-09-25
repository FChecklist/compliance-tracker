/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-01 (2026-09-25): the construction financial-redaction
// leak. Budget/margin/cost figures are for manager rank and above; before
// this item four places let them out to anyone whose role the redaction never
// saw:
//   1. api/mcp/[token] (the personal AI link) called runSubmission with no role;
//   2. pipeline/executor.ts makeDispatchExecutor dropped task.role on its way to
//      dispatchTool, so get_construction_budget_status / review_budget /
//      list_over_budget_projects ran unredacted for every pipeline caller;
//   3. api/v1/projexa/assistant passed ctx.dbUser?.role, always null for the
//      per-org API key PROJEXA's own assistant calls it with;
//   4. construction-tools.ts (and executor.ts's dashboard copy) read an
//      unknown role as "show the figures".
//
// WHAT IS FAKED, AND WHAT IS NOT. Faked: the database (@/lib/db's raw client,
// withTenantContext, and the two construction read services, whose only job
// here is to return stored figures) and authentication (requireAuthOrApiKey).
// resolveActingUser, requireRoleOrScope, both route POST functions, executeTask,
// dispatchTool and dispatchConstructionTool all run for real.
//
// One stand-in beyond the database: run-submission.ts's segment/classify/
// mint stages are DB- and model-backed with no mocked-DB seam (see
// run-submission.test.ts's own header), so runSubmission is replaced by a
// fixed phrase -> function table that then hands executeTask exactly the
// fields run-submission.ts:529-543 hands it (orgId, userId, projectId,
// functionId, params, role). Everything from executeTask down is real.
//
// Falsifiability (R74-RULING-03 (c)), checked 2026-09-25 by reverting each fix
// alone, running this file, and restoring the bytes:
//   site 1 reverted -> 2 fail in (a) (member role never reaches the pipeline;
//                      the manager is redacted);
//   site 2 reverted -> 2 fail: the manager tests in (a) and (b);
//   site 3 reverted -> 4 fail in (b)/(c) (named member/manager, USER_NOT_LINKED;
//                      U-01d since made that last one a redaction check, see (c));
//   site 4 reverted -> 7 fail: every unknown-role test in (a)-(d);
//   executor.ts's dashboard copy alone reverted -> 3 fail;
//   ledgerBudget/progressByBoqValuePct dropped from the redaction -> 6 fail.
import { beforeEach, describe, expect, mock, test } from "bun:test"

const ORG = "org-u01"
const PROJECT = "p-u01"
const TOKEN = "t".repeat(43)
const LINK_OWNER_ID = "user-link-owner"

// Stored figures the fake services return. A redacted response must carry
// none of the money ones.
const DASHBOARD = {
  projectId: PROJECT,
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 4_200_000,
  ledgerBudget: 4_000_000,
  revenue: 5_100_000,
  expenses: 3_900_000,
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
const BUDGET_VS_ACTUAL = { budget: 4_200_000, ledgerBudget: 4_000_000, actual: 3_900_000, variance: 300_000, byHead: [] }

// ── per-test state the fakes read ─────────────────────────────────────────
let linkOwnerRow: { role: string; isActive: boolean } | undefined
let actingUserRow: { id: string; role: string; isActive: boolean; email: string; orgId: string } | undefined
let authCtx: unknown
let budgetReads = 0

beforeEach(() => {
  linkOwnerRow = undefined
  actingUserRow = undefined
  authCtx = null
  budgetReads = 0
})

// ── the database ──────────────────────────────────────────────────────────
// Raw client: platform.rpc_resolve_ai_link_token (resolveAiLinkToken) and the
// compliance.users lookup resolveActingUser runs for an API-key caller.
const realDb = await import("@/lib/db")
mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    execute: mock(async () => [{ org_id: ORG, user_id: LINK_OWNER_ID }]),
    query: { users: { findFirst: mock(async () => actingUserRow) } },
  },
}))

// Tenant transaction: resolveAiLinkOwnerRole reads the link owner's row here;
// dispatchTool receives this same transaction object and passes it to the
// services below.
const realTenantScoped = await import("@/lib/db/tenant-scoped")
const fakeTx = { query: { users: { findFirst: mock(async () => linkOwnerRow) } } }
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(fakeTx)),
}))

const realDashboardService = await import("@/lib/services/construction-dashboard-service")
mock.module("@/lib/services/construction-dashboard-service", () => ({
  ...realDashboardService,
  getProjectDashboard: mock(async () => ({ ...DASHBOARD })),
  getProjectDashboardsWithDb: mock(async () => [{ ...DASHBOARD }]),
}))

const realReportsService = await import("@/lib/services/construction-reports-service")
mock.module("@/lib/services/construction-reports-service", () => ({
  ...realReportsService,
  budgetVsActual: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
  budgetVsActualWithDb: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
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
  "review the budget": "review_budget",
  "how is the project doing": "get_construction_project_dashboard",
}
const rolesSeenBySubmission: Array<string | null | undefined> = []
mock.module("@/lib/pipeline/run-submission", () => ({
  runSubmission: mock(async (input: { orgId: string; userId: string; projectId?: string | null; rawInput: string; role?: string | null }) => {
    rolesSeenBySubmission.push(input.role)
    const functionId = PHRASE_TO_FUNCTION[input.rawInput.trim().toLowerCase()]
    if (!functionId) throw new Error(`phrase not in the test table: ${input.rawInput}`)
    const { executeTask } = await import("./executor")
    const outcome = await executeTask({
      orgId: input.orgId, userId: input.userId, projectId: input.projectId ?? null,
      functionId, params: {}, role: input.role,
    })
    return {
      submissionId: "sub-u01", status: outcome.success ? "done" : "failed", classification: "task",
      chatMessages: [],
      tasks: [outcome.success
        ? { taskId: "task-u01", functionId, verdict: "chat", status: "done", segmentText: input.rawInput, result: outcome.result }
        : { taskId: "task-u01", functionId, verdict: "chat", status: "blocked", segmentText: input.rawInput, failure: outcome.failure }],
      failures: outcome.success ? [] : [{ segmentText: input.rawInput, ...outcome.failure }],
      gaps: [], flagged: false, l0HitRate: 1, modelCalls: 0,
    }
  }),
}))

const { POST: linkPOST } = await import("@/app/api/mcp/[token]/route")
const { POST: assistantPOST } = await import("@/app/api/v1/projexa/assistant/route")
const { executeTask } = await import("./executor")
const { dispatchConstructionTool, financialsAllowedForRole } = await import("@/lib/task-execution/construction-tools")

// ── callers ───────────────────────────────────────────────────────────────
type TaskShape = { status: string; result?: unknown; failure?: { code: string } }

async function viaLink(rawInput: string): Promise<{ status: number; task: TaskShape; text: string }> {
  const request = new Request(`https://x/api/mcp/${TOKEN}`, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_task", arguments: { rawInput, projectId: PROJECT } } }),
  })
  const res = await linkPOST(request, { params: Promise.resolve({ token: TOKEN }) })
  const body = await res.json()
  const text: string = body.result.content[0].text
  return { status: res.status, task: JSON.parse(text).tasks[0], text }
}

async function viaAssistant(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request("https://x/api/v1/projexa/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof assistantPOST>[0]
  const res = await assistantPOST(request)
  return { status: res.status, body: await res.json() }
}

const API_KEY_CTX = { orgId: ORG, dbUser: null, apiKey: { id: "key-u01", name: "PROJEXA org key", scopes: ["read", "write"] }, response: null }
function actingUser(role: string) {
  return { id: `user-${role}`, role, isActive: true, email: `${role}@example.test`, orgId: ORG }
}

// ── (a) the personal AI link ──────────────────────────────────────────────
describe("U-01 (a) -- api/mcp/[token]: the link owner's own role decides", () => {
  test("a member link owner asking for the budget gets a refusal, and the budget is never read", async () => {
    linkOwnerRow = { role: "member", isActive: true }
    const { status, task, text } = await viaLink("show me the budget")
    expect(status).toBe(200)
    expect(rolesSeenBySubmission.at(-1)).toBe("member")
    expect(task.status).toBe("blocked")
    expect(task.result).toBeUndefined()
    // construction-tools.ts throws "requires manager role or higher"; executeTask
    // turns that plain Error into INTERNAL_ERROR (today's shape for this refusal).
    expect(task.failure?.code).toBe("INTERNAL_ERROR")
    expect(budgetReads).toBe(0)
    expect(text).not.toContain("4200000")
  })

  test("the review_budget alias refuses a member the same way", async () => {
    linkOwnerRow = { role: "member", isActive: true }
    const { task } = await viaLink("review the budget")
    expect(task.failure?.code).toBe("INTERNAL_ERROR")
    expect(budgetReads).toBe(0)
  })

  test("a member link owner's project dashboard comes back with every money field null", async () => {
    linkOwnerRow = { role: "member", isActive: true }
    const { task } = await viaLink("how is the project doing")
    expect(task.result).toEqual(REDACTED_DASHBOARD)
  })

  test("a manager link owner still gets the budget and the full dashboard", async () => {
    linkOwnerRow = { role: "manager", isActive: true }
    expect((await viaLink("show me the budget")).task.result).toEqual(BUDGET_VS_ACTUAL)
    expect((await viaLink("how is the project doing")).task.result).toEqual(DASHBOARD)
    expect(budgetReads).toBe(1)
  })

  test("a link whose owner has no active user row is refused before any tool runs (PMD-33), not redacted", async () => {
    // Before PMD-33 this case was redacted and still ran the tools: an orphaned link could not read the money figures but could
    // still write (add a roster entry, revise a BOQ) under a person who is no longer an active user. Now nothing runs.
    const submissionsBefore = rolesSeenBySubmission.length
    for (const row of [undefined, { role: "manager", isActive: false }] as Array<typeof linkOwnerRow>) {
      linkOwnerRow = row
      const request = new Request(`https://x/api/mcp/${TOKEN}`, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "submit_task", arguments: { rawInput: "show me the budget", projectId: PROJECT } } }),
      })
      const res = await linkPOST(request, { params: Promise.resolve({ token: TOKEN }) })
      const body = await res.json()
      expect(body.result).toBeUndefined()
      expect(body.error.code).toBe(-32000)
      expect(body.error.message).toContain("no longer an active user of this organisation")
    }
    expect(rolesSeenBySubmission.length).toBe(submissionsBefore) // runSubmission was never called
    expect(budgetReads).toBe(0)
  })
})

// ── (b) the assistant's rawInput pipeline path, as PROJEXA calls it ───────
describe("U-01 (b) -- api/v1/projexa/assistant rawInput path with the org API key", () => {
  test("an API-key call naming a member (X-Acting-User) gets the budget refused", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = actingUser("member")
    const { status, body } = await viaAssistant({ rawInput: "show me the budget", projectId: PROJECT }, { "x-acting-user": "auth-member" })
    expect(status).toBe(201)
    expect(rolesSeenBySubmission.at(-1)).toBe("member")
    const task = (body.tasks as TaskShape[])[0]
    expect(task.failure?.code).toBe("INTERNAL_ERROR")
    expect(task.result).toBeUndefined()
    expect(budgetReads).toBe(0)
  })

  test("an API-key call naming a manager still gets the budget", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = actingUser("manager")
    const { status, body } = await viaAssistant({ rawInput: "show me the budget", projectId: PROJECT }, { "x-acting-user-email": "manager@example.test" })
    expect(status).toBe(201)
    expect((body.tasks as TaskShape[])[0].result).toEqual(BUDGET_VS_ACTUAL)
  })

  test("an API-key call naming nobody (unknown role) is redacted, not refused", async () => {
    authCtx = API_KEY_CTX
    const { status, body } = await viaAssistant({ rawInput: "how is the project doing", projectId: PROJECT })
    expect(status).toBe(201)
    expect(rolesSeenBySubmission.at(-1)).toBeNull()
    expect((body.tasks as TaskShape[])[0].result).toEqual(REDACTED_DASHBOARD)
  })
})

// ── (c) the assistant's codeReference path, as PROJEXA calls it ───────────
describe("U-01 (c) -- api/v1/projexa/assistant codeReference path with the org API key", () => {
  test("no actor identity: get_construction_budget_status is refused and never read", async () => {
    authCtx = API_KEY_CTX
    const { status, body } = await viaAssistant({ codeReference: "get_construction_budget_status", inputs: { projectId: PROJECT } })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "This action requires manager role or higher" })
    expect(budgetReads).toBe(0)
  })

  test("no actor identity: the project dashboard comes back with every money field null", async () => {
    authCtx = API_KEY_CTX
    const { status, body } = await viaAssistant({ codeReference: "get_construction_project_dashboard", inputs: { projectId: PROJECT } })
    expect(status).toBe(200)
    expect(body).toEqual({ codeReference: "get_construction_project_dashboard", result: REDACTED_DASHBOARD })
  })

  test("a member named by header is refused the budget", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = actingUser("member")
    const { status, body } = await viaAssistant({ codeReference: "get_construction_budget_status", inputs: { projectId: PROJECT } }, { "x-acting-user": "auth-member" })
    expect(status).toBe(400)
    expect(body).toEqual({ error: "This action requires manager role or higher" })
  })

  test("a manager named by header still gets the budget and the full dashboard", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = actingUser("manager")
    const budget = await viaAssistant({ codeReference: "get_construction_budget_status", inputs: { projectId: PROJECT } }, { "x-acting-user": "auth-manager" })
    expect(budget.status).toBe(200)
    expect(budget.body).toEqual({ codeReference: "get_construction_budget_status", result: BUDGET_VS_ACTUAL })
    const dashboard = await viaAssistant({ codeReference: "get_construction_project_dashboard", inputs: { projectId: PROJECT } }, { "x-acting-user": "auth-manager" })
    expect(dashboard.body).toEqual({ codeReference: "get_construction_project_dashboard", result: DASHBOARD })
  })

  // U-01d (PM decision D1): was "keeps resolveActingUser's 400 USER_NOT_LINKED".
  // A redaction fix must not turn an unlinked person's working request into an error.
  test("a named actor that maps to no user is redacted, not refused", async () => {
    authCtx = API_KEY_CTX
    actingUserRow = undefined
    const { status, body } = await viaAssistant({ codeReference: "get_construction_project_dashboard", inputs: { projectId: PROJECT } }, { "x-acting-user": "auth-nobody" })
    expect(status).toBe(200)
    expect(body).toEqual({ codeReference: "get_construction_project_dashboard", result: REDACTED_DASHBOARD })
  })

  test("a session manager is unchanged: role comes from the session, not a header", async () => {
    authCtx = { orgId: ORG, dbUser: { id: "user-session", role: "manager" }, apiKey: null, response: null }
    const { status, body } = await viaAssistant({ codeReference: "get_construction_budget_status", inputs: { projectId: PROJECT } })
    expect(status).toBe(200)
    expect(body.result).toEqual(BUDGET_VS_ACTUAL)
  })
})

// ── (d) the fail-open default is gone ─────────────────────────────────────
describe("U-01 (d) -- an unknown role is never read as 'show the figures'", () => {
  test("financialsAllowedForRole: only a known role of manager rank or above passes", () => {
    for (const unknownRole of [undefined, null, "", "not_a_role"]) expect(financialsAllowedForRole(unknownRole)).toBe(false)
    for (const below of ["viewer", "client_viewer", "member", "team_member"]) expect(financialsAllowedForRole(below)).toBe(false)
    for (const allowed of ["manager", "senior_professional", "branch_manager", "admin"]) expect(financialsAllowedForRole(allowed)).toBe(true)
  })

  test("dispatchConstructionTool with no role refuses the budget and redacts the dashboard", async () => {
    await expect(
      dispatchConstructionTool(ORG, "user-x", "get_construction_budget_status", { inputs: { projectId: PROJECT } })
    ).rejects.toThrow("This action requires manager role or higher")
    await expect(
      dispatchConstructionTool(ORG, "user-x", "list_over_budget_projects", {}, null)
    ).rejects.toThrow("This action requires manager role or higher")
    expect(await dispatchConstructionTool(ORG, "user-x", "get_construction_project_dashboard", { inputs: { projectId: PROJECT } })).toEqual(REDACTED_DASHBOARD)
    expect(budgetReads).toBe(0)
  })

  test("executeTask with no role redacts the dashboard and refuses the budget", async () => {
    const base = { orgId: ORG, userId: "user-x", projectId: PROJECT, params: {} }
    expect(await executeTask({ ...base, functionId: "get_construction_project_dashboard" })).toEqual({ success: true, result: REDACTED_DASHBOARD })
    const budget = await executeTask({ ...base, functionId: "get_construction_budget_status" })
    expect(budget.success).toBe(false)
    expect(budgetReads).toBe(0)
  })
})
