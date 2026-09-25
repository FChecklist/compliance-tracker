/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-15 acceptance test.
//
// THE BUG. tools/list on this MCP server is database-driven: it served every
// global compliance.worker_agents row with a code_reference -- 22 of them --
// while handleTool() has a branch for only 9. The other 13 (6 GST, 7
// construction, seeded by drizzle/0110 and drizzle/0114) were discoverable by
// an AI client and then failed on tools/call with 'Unknown tool: <name>'.
//
// THE CONTRACT NOW. tools/list serves only names in IMPLEMENTED_TOOL_NAMES
// (derived from TOOL_DEFINITIONS, each of which has a handleTool() branch),
// on both the database path and the built-in fallback path. The 13 tools are
// NOT implemented here (item U-39 decided to drop them; see the U-39 section
// at the end of this file); calling one returns the same JSON-RPC error it
// returned before.
//
// The drift guard is the "every advertised name" test: it calls each name
// tools/list returns, so adding a TOOL_DEFINITIONS entry without a branch, or
// removing the filter, fails this file.
//
// Only the Supabase client module is mocked (it carries both the api_keys
// lookup behind the Bearer token and every table read), plus global fetch for
// the 2 tools that call /api/v1 internally. The route's own dispatch and
// tool code run for real.
import { describe, test, expect, mock, spyOn, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import { getTableName } from "drizzle-orm"
import type { AiLinkIdentity } from "@/lib/ai-links/user-links"

// First dynamic import() of ./route compiles next/server and the route cold;
// same bump, same reason, as ../v1/projexa/permits/route.test.ts.
setDefaultTimeout(20000)

const IMPLEMENTED = [
  "list_compliance_items",
  "get_compliance_stats",
  "get_overdue_items",
  "create_compliance_item",
  "update_compliance_status",
  "list_departments",
  "get_penalty_estimate",
  "list_notices",
  "get_task_status",
]

// drizzle/0114_gst_worker_agents.sql + drizzle/0110_wave128_construction_worker_agents.sql
const NOT_IMPLEMENTED = [
  "confirm_gst_batch",
  "generate_gst_ai_review",
  "generate_gst_return",
  "list_gst_import_batches",
  "list_gst_returns",
  "run_gst_reconciliation",
  "get_construction_project_dashboard",
  "list_delayed_activities",
  "get_construction_budget_status",
  "list_over_budget_projects",
  "get_construction_kpi_status",
  "generate_construction_progress_summary",
  "detect_construction_budget_schedule_risk",
]

// The 22 global rows, interleaved so an order-dependent filter cannot pass.
const DB_ROWS = [...IMPLEMENTED, ...NOT_IMPLEMENTED]
  .sort()
  .map((name) => ({
    code_reference: name,
    description: `db description of ${name}`,
    input_schema: { type: "object", properties: {} },
  }))

type QueryResult = { data: unknown; error: unknown; count?: number }

// What the tools/list query on worker_agents resolves to; each scenario sets it.
let workerAgentsList: QueryResult = { data: DB_ROWS, error: null }

function listResult(table: string): QueryResult {
  if (table === "worker_agents") return workerAgentsList
  return { data: [], error: null, count: 0 }
}

function singleResult(table: string): QueryResult {
  if (table === "api_keys") {
    return {
      data: { id: "key-1", org_id: "org-1", scopes: "read,write", is_active: true, domain_scope: null },
      error: null,
    }
  }
  // logToolUsage() looks the tool up by code_reference and stops on null.
  if (table === "worker_agents") return { data: null, error: null }
  if (table === "departments") return { data: { id: "dept-1" }, error: null }
  if (table === "users") return { data: { id: "user-1" }, error: null }
  return { data: { id: "ci-1", title: "Item", status: "pending" }, error: null }
}

// A PostgREST-style chain: every builder method returns the chain,
// .single()/.maybeSingle() resolve one row, and awaiting the chain itself
// resolves the table's list result.
function queryChain(table: string): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: QueryResult) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(listResult(table)).then(resolve, reject)
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => Promise.resolve(singleResult(table))
        }
        return () => chain
      },
    },
  )
  return chain
}

// U-39: every table the route asks the Supabase client for, so a test can
// show that a refused call read no construction data. Reset by the U-39 tests.
const tablesRead: string[] = []

mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({
    from: (table: string) => {
      tablesRead.push(table)
      return queryChain(table)
    },
  })),
}))

const realFetch = globalThis.fetch
const internalFetch = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

beforeEach(() => {
  workerAgentsList = { data: DB_ROWS, error: null }
  internalFetch.mockClear()
  globalThis.fetch = internalFetch as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function rpcRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: { authorization: "Bearer vk_test", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function listToolNames(): Promise<string[]> {
  const { POST } = await import("./route")
  const res = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
  expect(res.status).toBe(200)
  const body = await res.json()
  return (body.result.tools as Array<{ name: string }>).map((t) => t.name)
}

async function callTool(name: string) {
  const { POST } = await import("./route")
  const res = await POST(
    rpcRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name,
        // One argument set that satisfies every implemented tool's required fields.
        arguments: {
          id: "ci-1",
          status: "pending",
          title: "Item",
          compliance_type: "GST",
          department_id: "dept-1",
          due_date: "2026-10-01",
          days_late: 3,
        },
      },
    }),
  )
  return { status: res.status, body: await res.json() }
}

const SCENARIOS: Array<{ label: string; result: QueryResult }> = [
  { label: "database returns all 22 rows", result: { data: DB_ROWS, error: null } },
  { label: "database returns no rows (built-in fallback)", result: { data: [], error: null } },
  { label: "database query errors (built-in fallback)", result: { data: null, error: { message: "boom" } } },
]

describe("POST /api/mcp tools/list advertises only implemented tools (U-15)", () => {
  test("(a) with all 22 database rows, tools/list returns exactly the 9 implemented names", async () => {
    const names = await listToolNames()

    expect([...names].sort()).toEqual([...IMPLEMENTED].sort())
    for (const name of NOT_IMPLEMENTED) expect(names).not.toContain(name)
  })

  test("(a) the database path still serves the database's own description for each tool", async () => {
    const { POST } = await import("./route")
    const body = await (await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()

    for (const tool of body.result.tools as Array<{ name: string; description: string }>) {
      expect(tool.description).toBe(`db description of ${tool.name}`)
    }
  })

  test("(a) the GET discovery probe lists the same 9 names", async () => {
    const { GET } = await import("./route")
    const body = await (await GET()).json()

    expect([...(body.tools as string[])].sort()).toEqual([...IMPLEMENTED].sort())
  })

  for (const scenario of SCENARIOS) {
    test(`(b) ${scenario.label}: no advertised tool answers 'Unknown tool'`, async () => {
      workerAgentsList = scenario.result
      const names = await listToolNames()
      expect(names.length).toBeGreaterThan(0)

      const unknown: string[] = []
      for (const name of names) {
        const { status, body } = await callTool(name)
        expect(status).toBe(200)
        if (String(body.error?.message ?? "").includes("Unknown tool")) unknown.push(name)
      }
      // Lists the offending names on failure, not just a count.
      expect(unknown).toEqual([])
    })

    test(`(d) ${scenario.label}: all 9 static definitions are advertised`, async () => {
      workerAgentsList = scenario.result
      const names = await listToolNames()

      expect([...names].sort()).toEqual([...IMPLEMENTED].sort())
    })
  }

  test("(b) the 2 internal /api/v1 tools reach the stubbed fetch, not the network", async () => {
    await callTool("list_notices")
    await callTool("get_task_status")

    expect(internalFetch).toHaveBeenCalledTimes(2)
  })

  test("(c) calling any of the 13 unimplemented tools returns the unchanged JSON-RPC error", async () => {
    for (const name of NOT_IMPLEMENTED) {
      const { status, body } = await callTool(name)

      expect(status).toBe(200)
      expect(body).toEqual({
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32000, message: `Unknown tool: ${name}` },
      })
    }
  })
})

// ===========================================================================
// PROJEXA-BUILD-001 U-39 (register row BR-514): the 13 construction and GST
// tools, and whose person and role a construction read answers to.
//
// WHAT THE CODE SAYS (read 2026-09-25 on origin/main f39a82f2):
//   - There are two MCP surfaces. POST /api/mcp (route.ts, beside this file)
//     takes a Bearer API key and nothing else: there is no session path, and
//     resolveToken() returns an org, scopes and a domain scope, never a person
//     or a role. Its tools/list names the 9 tools above, each with a
//     handleTool() branch. POST /api/mcp/[token] is the personal AI link: its
//     tools/list names submit_task and ask, each with a handleTool() branch.
//     A link names one person (platform.user_ai_links.user_id is NOT NULL),
//     and that person's role is read on every tools/call
//     (resolveAiLinkOwnerRole).
//   - The 13 (NOT_IMPLEMENTED above) have no branch on either surface. PM
//     decision for U-39: drop them. They stay unadvertised, and a call by
//     name gets the standard unknown-tool error on both surfaces.
//   - So the API-key door, which carries neither a person nor a role, has no
//     path to construction data at all. From /api/mcp, construction data is
//     reachable only through [token]'s submit_task and ask, which run the
//     pipeline (runSubmission -> executeTask) as the link's person, with that
//     person's role.
//
// WHAT IS REAL in the [token] tests: the route, runSubmission, the Level 0
// tiers, validate(), executeTask, dispatchTool and dispatchConstructionTool,
// with their redaction. WHAT IS FAKED: the link lookup and the owner-role
// read (@/lib/ai-links/user-links), the tenant database (the staged-row store
// of [token]/route.project-scope.test.ts; its promoted-phrase row is what
// gives a Level 0 hit), the two construction read services (they only return
// stored figures), and runLevel1 (a spy that throws, so a model call fails
// the test).
// ===========================================================================

const LINK_ORG = "org-u39"
const LINK_PERSON = "user-u39-link-owner"
const LINK_PROJECT = "p-u39"
const LINK: AiLinkIdentity = {
  orgId: LINK_ORG,
  userId: LINK_PERSON,
  product: "veridian",
  projectId: null,
  authorityLevel: 0,
  allowedFunctions: [],
  hidePersonal: true,
}

// Stored figures the fake construction services return. A redacted answer
// carries none of the money ones.
const DASHBOARD = {
  projectId: LINK_PROJECT,
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 4_200_000,
  ledgerBudget: 4_000_000,
  revenue: 5_100_000,
  expenses: 3_900_000,
  progressPercent: 41,
  progressByBoqValuePct: 38,
  delayedTaskCount: 2,
  taskCount: 10,
  projectValue: 6_000_000,
  earnedValue: 2_280_000,
  percentByValue: 38,
  contractValue: 6_000_000,
}
const REDACTED_DASHBOARD = {
  ...DASHBOARD,
  budget: null, ledgerBudget: null, revenue: null, expenses: null,
  projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
  progressByBoqValuePct: null,
}
const BUDGET_VS_ACTUAL = { budget: 4_200_000, ledgerBudget: 4_000_000, actual: 3_900_000, variance: 300_000, byHead: [] }

// ── the tenant database: staged rows, committed when the callback returns ──
type LinkRow = { id: string; table: string } & Record<string, unknown>
type LinkStore = { committed: LinkRow[]; nextId: number; phraseMapRow: Record<string, unknown> | null }

function thenable(run: () => unknown) {
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  }
}

function makeTransaction(store: LinkStore) {
  const working: LinkRow[] = store.committed.map((r) => ({ ...r }))
  const query = new Proxy(
    {},
    {
      get: (_target, table) => {
        if (typeof table !== "string" || table === "then") return undefined
        return {
          findFirst: async () => (table === "phraseMap" ? (store.phraseMapRow ?? undefined) : undefined),
          findMany: async () => [],
        }
      },
    },
  )
  const stage = (table: Parameters<typeof getTableName>[0], v: Record<string, unknown>): LinkRow => {
    const row: LinkRow = { ...v, id: `row_${store.nextId++}`, table: getTableName(table) }
    working.push(row)
    return row
  }
  const db = {
    query,
    // The phrase-fuzzy tier runs raw SQL through db.execute; nothing scores.
    execute: async () => [],
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: stage(table, v).id }],
        onConflictDoUpdate: () => thenable(() => stage(table, v)),
        ...thenable(() => stage(table, v)),
      }),
    }),
    update: () => ({ set: () => ({ where: () => thenable(() => undefined) }) }),
  }
  return { db, commit: () => { store.committed = working } }
}

let linkStore: LinkStore = { committed: [], nextId: 1, phraseMapRow: null }
let linkIdentity: AiLinkIdentity = LINK
let linkOwnerRole: string | null = "member"
let budgetReads = 0

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realUserLinks = await import("@/lib/ai-links/user-links")
const realLevel1 = await import("@/lib/pipeline/level1")
const realDashboardService = await import("@/lib/services/construction-dashboard-service")
const realReportsService = await import("@/lib/services/construction-reports-service")

const runLevel1Spy = mock(async (): Promise<never> => {
  throw new Error("runLevel1 must not be called on the AI link")
})
const ownerRoleSpy = mock(async (_identity: { orgId: string; userId: string }) => linkOwnerRole)

mock.module("@/lib/ai-links/user-links", () => ({
  ...realUserLinks,
  resolveAiLinkToken: mock(async () => linkIdentity),
  resolveAiLinkOwnerRole: ownerRoleSpy,
}))
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction(linkStore)
    const result = await fn(txn.db)
    txn.commit()
    return result
  }),
}))
mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1: runLevel1Spy }))
mock.module("@/lib/services/construction-dashboard-service", () => ({
  ...realDashboardService,
  getProjectDashboard: mock(async () => ({ ...DASHBOARD })),
}))
mock.module("@/lib/services/construction-reports-service", () => ({
  ...realReportsService,
  budgetVsActual: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
  budgetVsActualWithDb: mock(async () => { budgetReads += 1; return { ...BUDGET_VS_ACTUAL } }),
}))

afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/services/construction-reports-service", () => realReportsService)
  await mock.module("@/lib/services/construction-dashboard-service", () => realDashboardService)
  await mock.module("@/lib/pipeline/level1", () => realLevel1)
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/ai-links/user-links", () => realUserLinks)
})

const { CONSTRUCTION_TOOL_CODES } = await import("@/lib/task-execution/construction-tools")

let silenced: Array<{ mockRestore: () => void }> = []

function resetU39State() {
  tablesRead.length = 0
  linkStore = { committed: [], nextId: 1, phraseMapRow: null }
  linkIdentity = LINK
  linkOwnerRole = "member"
  budgetReads = 0
  runLevel1Spy.mockClear()
  ownerRoleSpy.mockClear()
  // runSubmission logs one line per submission; the assertions read the response.
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ]
}

function restoreConsole() {
  for (const s of silenced) s.mockRestore()
  silenced = []
}

type LinkBody = {
  jsonrpc?: string
  id?: unknown
  error?: { code: number; message: string }
  result?: { content: { type: string; text: string }[]; tools?: Array<{ name: string }> }
}

/** One JSON-RPC call to POST /api/mcp/[token], through the real route. */
async function callLink(method: string, params?: Record<string, unknown>) {
  const { POST } = await import("./[token]/route")
  const res = await POST(
    new Request("https://x/api/mcp/tok", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 39, method, params }),
    }),
    { params: Promise.resolve({ token: "tok" }) },
  )
  return { status: res.status, body: (await res.json()) as LinkBody }
}

/** The one task a Level 0 hit on the promoted phrase minted, as submit_task returns it. */
async function linkTask(functionId: string) {
  linkStore.phraseMapRow = { functionId, fixedParams: {}, promotedAt: new Date() }
  const { status, body } = await callLink("tools/call", {
    name: "submit_task",
    arguments: { rawInput: "how is the cedar heights project doing", projectId: LINK_PROJECT },
  })
  expect(status).toBe(200)
  expect(body.error).toBeUndefined()
  const text = body.result!.content[0].text
  const result = JSON.parse(text) as { tasks: Array<{ functionId: string; result?: unknown; failure?: { code: string } }> }
  expect(result.tasks).toHaveLength(1)
  expect(result.tasks[0].functionId).toBe(functionId)
  return { task: result.tasks[0], text }
}

/** One tools/call to the API-key door (route.ts), with any extra headers. */
async function callDoor(name: string, headers: Record<string, string> = {}) {
  const { POST } = await import("./route")
  const res = await POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer vk_test", "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 39,
        method: "tools/call",
        params: { name, arguments: { projectId: LINK_PROJECT } },
      }),
    }),
  )
  return { status: res.status, body: await res.json() }
}

describe("U-39 (a) -- every name either MCP surface advertises has a dispatcher branch", () => {
  beforeEach(resetU39State)
  afterEach(restoreConsole)

  test("[token] tools/list names exactly submit_task and ask, and the GET probe the same two", async () => {
    const { body } = await callLink("tools/list")
    const names = (body.result!.tools ?? []).map((t) => t.name)
    expect([...names].sort()).toEqual(["ask", "submit_task"])

    const { GET } = await import("./[token]/route")
    const probe = await (await GET(new Request("https://x/api/mcp/tok"), { params: Promise.resolve({ token: "tok" }) })).json()
    expect([...(probe.tools as string[])].sort()).toEqual(["ask", "submit_task"])
  })

  test("[token] each advertised name, called with valid-looking arguments, answers with a result, not 'Unknown tool'", async () => {
    const args: Record<string, Record<string, unknown>> = {
      submit_task: { rawInput: "xyzzy unmatched phrase" },
      ask: { question: "xyzzy unmatched phrase" },
    }
    const { body: listed } = await callLink("tools/list")
    const unknown: string[] = []
    for (const { name } of listed.result!.tools ?? []) {
      const { status, body } = await callLink("tools/call", { name, arguments: args[name] ?? {} })
      expect(status).toBe(200)
      if (body.error || !body.result) unknown.push(`${name}: ${body.error?.message ?? "no result"}`)
    }
    expect(unknown).toEqual([])
  })

  test("no construction or GST name is advertised on either surface", async () => {
    const doorNames = await listToolNames()
    const { body } = await callLink("tools/list")
    const linkNames = (body.result!.tools ?? []).map((t) => t.name)

    expect(doorNames.filter((n) => NOT_IMPLEMENTED.includes(n))).toEqual([])
    expect(linkNames.filter((n) => NOT_IMPLEMENTED.includes(n))).toEqual([])
  })

  test("[token] a call to any of the 13 dropped names by name gets the standard unknown-tool error and runs nothing", async () => {
    for (const name of NOT_IMPLEMENTED) {
      const { status, body } = await callLink("tools/call", { name, arguments: { projectId: LINK_PROJECT } })
      expect(status).toBe(200)
      expect(body).toEqual({ jsonrpc: "2.0", id: 39, error: { code: -32000, message: `Unknown tool: ${name}` } })
    }
    // No submission, task or business row was written for any of them.
    expect(linkStore.committed).toEqual([])
  })
})

describe("U-39 (b) -- a construction call that carries no person or role is refused", () => {
  beforeEach(resetU39State)
  afterEach(restoreConsole)

  test("the API-key door (no person, no role): each construction tool refuses with a one-line JSON-RPC error and reads no construction table", async () => {
    // The engine's own list, so a construction tool added there is covered here.
    const construction = [...CONSTRUCTION_TOOL_CODES].sort()
    expect(construction.length).toBe(7)

    for (const name of construction) {
      tablesRead.length = 0
      const { status, body } = await callDoor(name)

      expect(status).toBe(200)
      expect(body.result).toBeUndefined()
      // A plain sentence: no stack frame, no internals, the same error any
      // unimplemented name gets.
      expect(body).toEqual({ jsonrpc: "2.0", id: 39, error: { code: -32000, message: `Unknown tool: ${name}` } })
      // Only the key lookup (api_keys) and the usage log (worker_agents) ran.
      expect([...new Set(tablesRead)].sort()).toEqual(["api_keys", "worker_agents"])
    }
  })

  test("the API-key door refuses the same way when the call names a person: it has no construction path for anyone", async () => {
    for (const name of CONSTRUCTION_TOOL_CODES) {
      tablesRead.length = 0
      const { body } = await callDoor(name, { "x-acting-user": "auth-manager", "x-acting-user-email": "manager@example.test" })

      expect(body).toEqual({ jsonrpc: "2.0", id: 39, error: { code: -32000, message: `Unknown tool: ${name}` } })
      expect(tablesRead.some((t) => t.startsWith("construction"))).toBe(false)
    }
  })

  test("[token] a link whose person has no active user row (no role): every tool call is refused before anything runs (PMD-33)", async () => {
    linkOwnerRole = null
    linkStore.phraseMapRow = { functionId: "get_construction_budget_status", fixedParams: {}, promotedAt: new Date() }

    for (const tool of ["get_construction_budget_status", "get_construction_project_dashboard"]) {
      linkStore.phraseMapRow = { functionId: tool, fixedParams: {}, promotedAt: new Date() }
      const { status, body } = await callLink("tools/call", {
        name: "submit_task",
        arguments: { rawInput: "how is the cedar heights project doing", projectId: LINK_PROJECT },
      })
      expect(status).toBe(200)
      expect(body.result).toBeUndefined()
      expect(body.error?.code).toBe(-32000)
      expect(body.error?.message).toContain("no longer an active user of this organisation")
      expect(JSON.stringify(body)).not.toContain("4200000")
    }
    // Nothing ran: no budget was read, and no submission was made for the link.
    expect(budgetReads).toBe(0)
    expect(runLevel1Spy).not.toHaveBeenCalled()
    // The role was read for the link's own person, not for anyone the call named.
    expect(ownerRoleSpy.mock.calls.map((c) => c[0].userId)).toEqual([LINK_PERSON, LINK_PERSON])
  })
})

describe("U-39 (c) -- with a person and a role, a construction tool answers, redacted per role ([token])", () => {
  beforeEach(resetU39State)
  afterEach(restoreConsole)

  test("below manager rank (member): the project dashboard answers with every money field null", async () => {
    linkOwnerRole = "member"

    const { task, text } = await linkTask("get_construction_project_dashboard")

    expect(task.result).toEqual(REDACTED_DASHBOARD)
    expect(text).not.toContain("4200000")
    expect(text).not.toContain("6000000")
    expect(ownerRoleSpy.mock.calls[0][0]).toMatchObject({ orgId: LINK_ORG, userId: LINK_PERSON })
    expect(runLevel1Spy).not.toHaveBeenCalled()
  })

  test("at manager rank: the same call answers with the figures", async () => {
    linkOwnerRole = "manager"

    const { task } = await linkTask("get_construction_project_dashboard")

    expect(task.result).toEqual(DASHBOARD)
  })

  test("the budget tool: refused for a member and never read, answered for an admin", async () => {
    linkOwnerRole = "member"
    const refused = await linkTask("get_construction_budget_status")
    expect(refused.task.result).toBeUndefined()
    expect(refused.task.failure?.code).toBeTruthy()
    expect(budgetReads).toBe(0)

    linkOwnerRole = "admin"
    const answered = await linkTask("get_construction_budget_status")
    expect(answered.task.result).toEqual(BUDGET_VS_ACTUAL)
    expect(budgetReads).toBe(1)
  })
})
