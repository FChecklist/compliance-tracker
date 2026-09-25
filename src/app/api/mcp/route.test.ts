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
// NOT implemented here (item U-39 decides whether to build or drop them);
// calling one returns the same JSON-RPC error it returned before.
//
// The drift guard is the "every advertised name" test: it calls each name
// tools/list returns, so adding a TOOL_DEFINITIONS entry without a branch, or
// removing the filter, fails this file.
//
// Only the Supabase client module is mocked (it carries both the api_keys
// lookup behind the Bearer token and every table read), plus global fetch for
// the 2 tools that call /api/v1 internally. The route's own dispatch and
// tool code run for real.
import { describe, test, expect, mock, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

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

mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({ from: (table: string) => queryChain(table) })),
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
