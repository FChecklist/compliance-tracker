/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46b1 (register row BR-482, AWL-S10): the MCP layer of the universal AI work link (supabase/functions/ai-work-link/
// mcp.ts, reached through the REAL handler). Both protocol eras on one endpoint: legacy initialize / tools/list / tools/call (2025-06-18),
// and 2026-07-28 with per-request _meta, header checks and server/discover. The Origin rule of section 4.2, a bad or revoked token
// answering 410 before any JSON-RPC is parsed (section 7.4), tool results that carry the same redacted rows /records does, and
// search and fetch results whose text is redacted by role and whose url is token-free (audit A-21, harness H22).
// Run: bun test --isolate src/lib/services/ai-work-link-mcp.test.ts
import { describe, test, expect } from "bun:test"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { originAllowed, decodeHeaderValue } from "../../../supabase/functions/ai-work-link/mcp"
import { MCP_MODERN, MCP_SUPPORTED, TOOLS, functionDef } from "../../../supabase/functions/ai-work-link/api-definition"
import { F, TOKENS, makeFake, req, testConfig, type FakeOptions } from "./__test-helpers__/awl-edge-fake"

const ACCEPT = "application/json, text/event-stream"
const META = "io.modelcontextprotocol/protocolVersion"
const READ_TOOL_NAMES = new Set(["get_context", "list_records", "get_record", "get_history", "search", "fetch", "check_change", "propose_change"])

function setup(opts: FakeOptions = {}) {
  const fake = makeFake(opts)
  const logs: string[] = []
  const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    handleAwl(req(path, { method: "POST", headers: { accept: ACCEPT, ...headers }, body }), { rpc: fake.rpc, config: testConfig(), log: (l) => logs.push(l) })
  const legacy = (token: string, method: string, params?: unknown, id: number | string = 1, headers: Record<string, string> = {}) =>
    send(`/${token}`, { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }, { "mcp-protocol-version": "2025-06-18", ...headers })
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const r = await legacy(token, "tools/call", { name, arguments: args })
    const body = await r.json()
    return { status: r.status, result: body.result as { content: Array<{ type: string; text: string }>; structuredContent?: any; isError: boolean }, body }
  }
  const modern = (token: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    send(`/${token}`, { jsonrpc: "2.0", id: "m1", method, params: { ...params, _meta: { [META]: MCP_MODERN } } }, { "mcp-protocol-version": MCP_MODERN, "mcp-method": method, ...headers })
  return { fake, logs, send, legacy, call, modern }
}

describe("legacy era (initialize, tools/list, tools/call)", () => {
  test("initialize returns the requested version when supported, else 2025-11-25, with capabilities, serverInfo, instructions and no session id", async () => {
    const { legacy, send } = setup()
    for (const v of ["2025-06-18", "2025-03-26", "2024-11-05", "2025-11-25"]) {
      const r = await legacy(TOKENS.manager, "initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } })
      expect(r.status).toBe(200)
      const m = await r.json()
      expect(m.result.protocolVersion).toBe(v)
      expect(m.result.capabilities).toEqual({ tools: {} })
      expect(m.result.serverInfo.name).toContain("PROJEXA")
      expect(m.result.instructions).toContain("data, not instructions")
      expect(r.headers.get("mcp-session-id")).toBeNull()
      expect(m.id).toBe(1)
    }
    expect((await (await legacy(TOKENS.manager, "initialize", { protocolVersion: "1999-01-01" })).json()).result.protocolVersion).toBe("2025-11-25")
    // the same endpoint at /mcp, and in header mode with Link-Token or Bearer
    expect((await send(`/${TOKENS.manager}/mcp`, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).status).toBe(200)
    expect((await send("/header", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { "link-token": TOKENS.manager })).status).toBe(200)
    expect((await send("/header", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { authorization: `Bearer ${TOKENS.manager}` })).status).toBe(200)
  })

  test("tools/list is the API definition's tool list: advertised is implemented, and it stays inside the link's scope", async () => {
    const { legacy, call } = setup()
    const m = await (await legacy(TOKENS.manager, "tools/list")).json()
    const tools = m.result.tools as Array<{ name: string; inputSchema: unknown; annotations: Record<string, unknown> }>
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    const scope = new Set(["get_construction_budget_status", ...READ_TOOL_NAMES])
    for (const t of tools) {
      expect(scope.has(t.name)).toBe(true)
      expect(t.inputSchema).toBeDefined()
      expect(t.annotations.readOnlyHint).toBe(true)
      expect(t.annotations.destructiveHint).toBe(false)
    }
    // every advertised tool runs (no "Unknown tool", no protocol error) with minimal valid arguments
    const args: Record<string, Record<string, unknown>> = {
      get_context: {}, list_records: { kind: "tasks" }, get_record: { kind: "tasks", id: "tasks-a001" }, get_history: {}, search: { query: "" }, fetch: { id: "tasks:tasks-a001" },
      check_change: { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } }, propose_change: { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } },
    }
    for (const t of tools) {
      const r = await call(TOKENS.manager, t.name, args[t.name])
      expect(r.status).toBe(200)
      expect(r.body.error).toBeUndefined()
      expect(r.result.isError).toBe(false)
    }
    // the tool set does not depend on the person's role: no function tool is advertised while no function can run
    const viewer = await (await legacy(TOKENS.viewer, "tools/list")).json()
    expect(viewer.result.tools.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name))
    for (const t of viewer.result.tools) expect(functionDef(t.name)).toBeNull()
  })

  test("every result carries structuredContent and the same JSON in a text item; get_context and list_records leave out the link address", async () => {
    const { call } = setup({ rowsPerKind: 5 })
    const ctx = await call(TOKENS.manager, "get_context")
    expect(ctx.result.isError).toBe(false)
    expect(JSON.parse(ctx.result.content[0].text)).toEqual(ctx.result.structuredContent)
    expect(ctx.result.structuredContent.base).toBeUndefined()
    expect(ctx.result.structuredContent.project.id).toBe("proj_a")
    const page = await call(TOKENS.manager, "list_records", { kind: "boq_lines", limit: 2 })
    expect(page.result.structuredContent.items).toHaveLength(2)
    expect(page.result.structuredContent.next).toBeUndefined()
    expect(page.result.structuredContent.next_after).toBe("boq_lines-a002")
    const next = await call(TOKENS.manager, "list_records", { kind: "boq_lines", limit: 2, after: "boq_lines-a002" })
    expect(next.result.structuredContent.items.map((i: any) => i.id)).toEqual(["boq_lines-a003", "boq_lines-a004"])
    const one = await call(TOKENS.manager, "get_record", { kind: "boq_lines", id: "boq_lines-a001" })
    expect(one.result.structuredContent.record.id).toBe("boq_lines-a001")
    const hist = await call(TOKENS.manager, "get_history")
    expect(hist.result.structuredContent.items).toHaveLength(1)
  })

  test("a member's list_records is redacted even when SQL leaks; a money filter or sort through MCP is an isError result and never reaches SQL", async () => {
    const { call, fake } = setup({ leaksMoney: true })
    const page = await call(TOKENS.member, "list_records", { kind: "boq_lines" })
    for (const item of page.result.structuredContent.items) {
      expect(item.rate).toBeNull()
      expect(item.amount).toBeNull()
      expect(item.redacted).toBe(true)
    }
    const before = fake.names().filter((n) => n === "ai_work_link_records").length
    for (const args of [{ kind: "boq_lines", filters: { amount_gt: "0" } }, { kind: "boq_lines", sort: "rate" }, { kind: "boq_lines", sort: "-amount" }, { kind: "roster", filters: { daily_rate_lt: "9" } }]) {
      const r = await call(TOKENS.member, "list_records", args)
      expect(r.result.isError).toBe(true)
      expect(r.result.content[0].text).toContain("This field is hidden for your role")
    }
    expect(fake.names().filter((n) => n === "ai_work_link_records").length).toBe(before)
    const ok = await call(TOKENS.manager, "list_records", { kind: "boq_lines", filters: { amount_gt: "0" }, sort: "-rate" })
    expect(ok.result.isError).toBe(false)
  })

  test("search and fetch: results from the redacted rows, urls that are token-free app links, money null for a member", async () => {
    const { call } = setup({ leaksMoney: true })
    for (const [token, hidden] of [[TOKENS.member, true], [TOKENS.manager, false]] as const) {
      const found = await call(token, "search", { query: "" })
      const results = found.result.structuredContent.results as Array<{ id: string; title: string; text: string; url: string }>
      expect(results.length).toBeGreaterThan(0)
      const boq = results.find((r) => r.id.startsWith("boq_lines:"))!
      const fetched = await call(token, "fetch", { id: boq.id })
      expect(fetched.result.isError).toBe(false)
      for (const item of [...results, fetched.result.structuredContent]) {
        expect(item.url.startsWith("https://projexa-ai.com/projects/proj_a/")).toBe(true)
        expect(item.url).not.toContain("pxa_")
        expect(item.url.startsWith(F)).toBe(false)
        expect(item.text).not.toContain(token.slice(4, 30))
      }
      const row = JSON.parse(fetched.result.structuredContent.text)
      if (hidden) {
        expect(row.rate).toBeNull()
        expect(row.amount).toBeNull()
        expect(results.map((r) => r.text).join(" ")).not.toMatch(/"(rate|amount|material_cost|daily_rate)":\s*-?\d/)
      } else {
        expect(row.rate).toBe(1001.5)
      }
    }
    const some = await call(TOKENS.manager, "search", { query: "boq_lines 2" })
    expect(some.result.structuredContent.results.every((r: any) => r.text.toLowerCase().includes("boq_lines 2"))).toBe(true)
    expect((await call(TOKENS.manager, "search", { query: "no-such-text-anywhere" })).result.structuredContent.results).toEqual([])
    expect((await call(TOKENS.manager, "fetch", { id: "boq_lines:nosuch" })).result.isError).toBe(true)
    expect((await call(TOKENS.manager, "fetch", { id: "nocolon" })).result.isError).toBe(true)
    expect((await call(TOKENS.otherProject, "fetch", { id: "boq_lines:boq_lines-a001" })).result.isError).toBe(true)
  })

  test("check_change and propose_change: scope errors are isError results, a proposal carries the token only in the confirm link's fragment", async () => {
    const { call } = setup()
    const chk = await call(TOKENS.manager, "check_change", { function: "record_work_progress", params: {} })
    expect(chk.result.structuredContent).toMatchObject({ valid: false, missing: ["itemCode", "percent"] })
    const wrong = await call(TOKENS.manager, "check_change", { function: "record_work_progress", params: { projectId: "proj_b" } })
    expect(wrong.result.isError).toBe(true)
    expect(wrong.result.content[0].text).toContain("403")
    const off = await call(TOKENS.member, "check_change", { function: "get_construction_budget_status" })
    expect(off.result.isError).toBe(true)
    const prop = await call(TOKENS.manager, "propose_change", { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } })
    expect(prop.result.structuredContent.confirm_url.split("#")[0]).not.toContain("pxa_")
    expect(prop.result.structuredContent.confirm_url).toContain(`#t=${TOKENS.manager}&p=`)
    expect(prop.result.structuredContent.note).toContain("Nothing has changed")
  })

  test("no other tool result carries the token", async () => {
    const { call } = setup({ leaksMoney: true })
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_context", {}], ["list_records", { kind: "tasks" }], ["get_record", { kind: "tasks", id: "tasks-a001" }], ["get_history", {}], ["search", { query: "" }], ["fetch", { id: "tasks:tasks-a001" }],
      ["check_change", { function: "record_work_progress", params: { itemCode: "EX-01", percent: 1 } }], ["list_records", { kind: "boq_lines", filters: { amount_gt: "1" } }], ["get_record", { kind: `${TOKENS.member}`, id: "x" }],
    ]
    for (const [name, args] of calls) {
      const r = await call(TOKENS.member, name, args)
      expect(JSON.stringify(r.body)).not.toContain(TOKENS.member.slice(4, 30))
    }
  })

  test("notifications are 202 with no body; ping works; an unknown method is a JSON-RPC error in a 200; an unknown tool is -32602", async () => {
    const { send, legacy, fake } = setup()
    const n = await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-06-18" })
    expect(n.status).toBe(202)
    expect(await n.text()).toBe("")
    expect((await (await legacy(TOKENS.manager, "ping")).json()).result).toEqual({})
    const u = await (await legacy(TOKENS.manager, "resources/list")).json()
    expect(u.error.code).toBe(-32601)
    const t = await (await legacy(TOKENS.manager, "tools/call", { name: "no_such_tool", arguments: {} })).json()
    expect(t.error.code).toBe(-32602)
    // a function that no link may run is not a tool either
    const f = await (await legacy(TOKENS.manager, "tools/call", { name: "record_work_progress", arguments: {} })).json()
    expect(f.error.code).toBe(-32602)
    expect(fake.names().filter((x) => x.includes("intent"))).toEqual([])
  })
})

describe("modern era (2026-07-28)", () => {
  test("server/discover lists the supported versions, the server info and instructions; every result is resultType complete", async () => {
    const { modern } = setup()
    const r = await modern(TOKENS.manager, "server/discover")
    expect(r.status).toBe(200)
    const m = await r.json()
    expect(m.result.supportedVersions).toEqual([...MCP_SUPPORTED])
    expect(m.result.supportedVersions).toContain("2026-07-28")
    expect(m.result.resultType).toBe("complete")
    expect(m.result.capabilities).toEqual({ tools: {} })
    expect(m.result._meta["io.modelcontextprotocol/serverInfo"].name).toContain("PROJEXA")
    expect(m.result.instructions).toContain("Read the manual")
    expect(r.headers.get("mcp-session-id")).toBeNull()
    const list = await (await modern(TOKENS.manager, "tools/list")).json()
    expect(list.result.resultType).toBe("complete")
    expect(list.result.tools.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name))
    const c = await (await modern(TOKENS.manager, "tools/call", { name: "get_context", arguments: {} }, { "mcp-name": "get_context" })).json()
    expect(c.result.resultType).toBe("complete")
    expect(c.result.isError).toBe(false)
  })

  test("a header that does not match the body, or is missing, is 400 with -32020", async () => {
    const { modern, send } = setup()
    const bad = async (r: Response) => { expect(r.status).toBe(400); expect((await r.json()).error.code).toBe(-32020) }
    await bad(await modern(TOKENS.manager, "server/discover", {}, { "mcp-method": "tools/list" }))
    await bad(await modern(TOKENS.manager, "server/discover", {}, { "mcp-protocol-version": "2025-06-18" }))
    await bad(await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { [META]: MCP_MODERN } } }))
    await bad(await modern(TOKENS.manager, "tools/call", { name: "get_context" }))
    await bad(await modern(TOKENS.manager, "tools/call", { name: "get_context" }, { "mcp-name": "get_record" }))
    // the header says modern while the body carries no _meta
    await bad(await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": MCP_MODERN }))
    // a name in the base64 sentinel form is decoded before it is compared
    const enc = `=?base64?${btoa("get_context")}?=`
    expect(decodeHeaderValue(enc)).toBe("get_context")
    expect((await modern(TOKENS.manager, "tools/call", { name: "get_context" }, { "mcp-name": enc })).status).toBe(200)
  })

  test("an unsupported version is 400 with -32022 and data.supported; an unknown method is 404 with -32601", async () => {
    const { send, modern } = setup()
    const r = await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { [META]: "2099-01-01" } } }, { "mcp-protocol-version": "2099-01-01", "mcp-method": "server/discover" })
    expect(r.status).toBe(400)
    const m = await r.json()
    expect(m.error.code).toBe(-32022)
    expect(m.error.data.supported).toEqual([...MCP_SUPPORTED])
    const u = await modern(TOKENS.manager, "resources/list")
    expect(u.status).toBe(404)
    expect((await u.json()).error.code).toBe(-32601)
    const batch = await send(`/${TOKENS.manager}`, [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { [META]: MCP_MODERN } } }], { "mcp-protocol-version": MCP_MODERN, "mcp-method": "server/discover" })
    expect(batch.status).toBe(400)
  })
})

describe("Origin (section 4.2)", () => {
  test("originAllowed: none, or any https origin; anything else is refused", () => {
    for (const o of [null, "", "https://claude.ai", "https://chatgpt.com", "https://example.com:8443"]) expect(originAllowed(o)).toBe(true)
    for (const o of ["http://example.com", "http://localhost:3000", "null", "not a url", "ftp://x.example", "file:///etc/passwd", "chrome-extension://abc", "javascript:alert(1)"]) expect(originAllowed(o)).toBe(false)
  })

  test("an Origin that is not allowed is 403 with a JSON-RPC error that has no id, on every MCP method; an allowed one is served", async () => {
    const { legacy, modern } = setup()
    for (const origin of ["http://evil.example", "null", "chrome-extension://abc"]) {
      const r = await legacy(TOKENS.manager, "tools/list", undefined, 5, { origin })
      expect(r.status).toBe(403)
      const m = await r.json()
      expect(m.jsonrpc).toBe("2.0")
      expect("id" in m).toBe(false)
      expect(m.error.code).toBeDefined()
      expect((await legacy(TOKENS.manager, "initialize", {}, 1, { origin })).status).toBe(403)
      expect((await modern(TOKENS.manager, "server/discover", {}, { origin })).status).toBe(403)
    }
    expect((await legacy(TOKENS.manager, "tools/list", undefined, 5, { origin: "https://claude.ai" })).status).toBe(200)
    expect((await legacy(TOKENS.manager, "tools/list")).status).toBe(200)
  })
})

describe("bad or revoked tokens (section 7.4): the link is checked before any JSON-RPC is parsed", () => {
  test("revoked, expired and unknown are 410 in the plain error shape, never 401, whatever the body; a malformed token is 404; a GET is 405", async () => {
    const { send, legacy } = setup()
    for (const t of [TOKENS.revoked, TOKENS.expired, TOKENS.unknown]) {
      const init = await legacy(t, "initialize", { protocolVersion: "2025-06-18" })
      expect(init.status).toBe(410)
      expect(init.headers.get("www-authenticate")).toBeNull()
      expect(await init.json()).toMatchObject({ error: "This link has expired or was revoked", status: 410 })
      const garbage = await send(`/${t}`, "{not json")
      expect(garbage.status).toBe(410)
      expect((await send(`/${t}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(410)
    }
    expect((await send("/not-a-token", { jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(404)
    const get = await handleAwl(req(`/${TOKENS.manager}`, { headers: { accept: "text/event-stream" } }), { rpc: makeFake().rpc, config: testConfig() })
    expect(get.status).toBe(405)
    expect(get.headers.get("allow")).toBe("POST")
    expect(get.headers.get("mcp-session-id")).toBeNull()
  })
})

describe("JSON-RPC framing", () => {
  test("parse error 400/-32700, invalid request 400/-32600, body over 8 KB 413, batches for the legacy era only", async () => {
    const { send, legacy, fake } = setup()
    const h = { "mcp-protocol-version": "2025-06-18" }
    const p = await send(`/${TOKENS.manager}`, "{oops", h)
    expect(p.status).toBe(400)
    expect(await p.json()).toMatchObject({ error: { code: -32700 }, id: null })
    const scalar = await send(`/${TOKENS.manager}`, "42", h)
    expect(scalar.status).toBe(400)
    expect((await scalar.json()).error.code).toBe(-32600)
    expect((await send(`/${TOKENS.manager}`, { id: 1, method: "tools/list" }, h)).status).toBe(400)
    expect((await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", id: 1 }, h)).status).toBe(400)
    const big = await send(`/${TOKENS.manager}`, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "x".repeat(9000) } } }, h)
    expect(big.status).toBe(413)
    const batch = await send(`/${TOKENS.manager}`, [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }], h)
    expect(batch.status).toBe(200)
    const out = await batch.json()
    expect(out.map((m: any) => m.id)).toEqual([1, 2])
    expect((await send(`/${TOKENS.manager}`, [], h)).status).toBe(400)
    const onlyNotes = await send(`/${TOKENS.manager}`, [{ jsonrpc: "2.0", method: "notifications/initialized" }], h)
    expect(onlyNotes.status).toBe(202)
    expect(fake.names().filter((n) => n === "ai_work_link_log_call").length).toBeGreaterThan(0)
    void legacy
  })

  test("an MCP call is one call-log row and counts toward the 120 a minute; the 121st is a plain 429", async () => {
    const { legacy, fake } = setup()
    for (let i = 0; i < 120; i++) expect((await legacy(TOKENS.manager, "ping")).status).toBe(200)
    expect(fake.logRows.filter((r) => r.path === "/")).toHaveLength(120)
    const over = await legacy(TOKENS.manager, "ping")
    expect(over.status).toBe(429)
    expect(over.headers.get("retry-after")).toBe("60")
  })

  test("a failed call log answers 503 on MCP too, with no JSON-RPC result", async () => {
    const { legacy, fake } = setup()
    fake.state.failLog = "error"
    const r = await legacy(TOKENS.manager, "tools/list")
    expect(r.status).toBe(503)
    expect((await r.json()).result).toBeUndefined()
    expect(new Set(fake.names())).toEqual(new Set(["ai_work_link_log_call"]))
  })
})
