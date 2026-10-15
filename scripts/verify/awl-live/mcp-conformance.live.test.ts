/// <reference types="bun-types" />
// Audit 100, checklist rows B45 (MCP at the link works from a client), A28/A29 (ChatGPT and Claude can use the link as a connector) and A35
// (work link = API = access token = link): the DEPLOYED Edge Function speaks MCP correctly over plain JSON-RPC on HTTP, using a throwaway
// link of a client_viewer (level 0, so nothing here can ever change data).
//
// What is checked, against the live function, not a fake:
//   1. initialize, in the legacy era (2024-11-05 and 2025-03-26 echoed back) and the modern era (2026-07-28 with its required headers);
//      the id comes back as sent, capabilities.tools is declared, serverInfo has a name and version;
//   2. notifications/initialized is accepted with 202 and no body; ping answers {};
//   3. tools/list: every tool has a unique legal name, a description, an inputSchema that is itself a valid JSON Schema of type object, and
//      readOnly annotations; the tools the manual promises are all there;
//   4. tools/call: list_projects returns text content that parses and matches REST /projects; get_portfolio and get_context work; a project of
//      another organisation is an isError result, not data; an unknown tool is JSON-RPC -32602; an unknown method -32601; bad JSON -32700 (400);
//   5. a JSON-RPC batch (legacy era) is answered as a batch in order; GET on the MCP path is 405.
// Run: bun test --isolate ./scripts/verify/awl-live/mcp-conformance.live.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { AWL_BASE, PEOPLE, call, expectPerson, foreignProjectId, jsonHeaders, linkStatus, liveEnabled, mintThrowaway, revoke, type Throwaway } from "./live-lib"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Ajv = require("ajv")
const ajv = new Ajv({ allErrors: true, logger: false })

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" }
const MODERN = "2026-07-28"

// the live network and database are sometimes slow (the shared database is busy): a test gets two minutes, not bun's default five seconds
setDefaultTimeout(120_000)

describe.skipIf(!liveEnabled())("MCP conformance, live", () => {
  let link: Throwaway
  const rpc = (body: unknown, extra: Record<string, string> = {}, url?: string) =>
    call(url ?? link.url, { method: "POST", idempotent: true, headers: { ...MCP_HEADERS, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) })

  beforeAll(async () => {
    await expectPerson(PEOPLE.viewer, "client_viewer")
    link = await mintThrowaway(PEOPLE.viewer, "audit100 mcp-conformance")
    expect(link.level).toBe(0) // a viewer link can only read: nothing in this file can change data
  }, 240_000)

  afterAll(async () => {
    if (link) await revoke(link.id)
  })

  test("initialize echoes the client's protocol version and the id, declares tools, names the server", async () => {
    for (const [v, id] of [["2024-11-05", "a-string-id"], ["2025-03-26", 7]] as const) {
      const r = await rpc({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "conformance", version: "1" } } })
      expect(r.status).toBe(200)
      expect(r.headers.get("content-type")).toContain("application/json")
      expect(r.json.jsonrpc).toBe("2.0")
      expect(r.json.id).toBe(id)
      expect(r.json.result.protocolVersion).toBe(v)
      expect(r.json.result.capabilities.tools).toBeDefined()
      expect(typeof r.json.result.serverInfo.name).toBe("string")
      expect(typeof r.json.result.serverInfo.version).toBe("string")
      expect(typeof r.json.result.instructions).toBe("string")
      // stateless: no session id is ever minted
      expect(r.headers.get("mcp-session-id")).toBeNull()
    }
  })

  test("modern era (2026-07-28): server/discover and tools/list with the required headers; a missing header is refused", async () => {
    const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } }
    const h = (method: string, name?: string) => ({ "mcp-protocol-version": MODERN, "mcp-method": method, ...(name ? { "mcp-name": name } : {}) })
    const d = await rpc({ jsonrpc: "2.0", id: 1, method: "server/discover", params: meta }, h("server/discover"))
    expect(d.status).toBe(200)
    expect(d.json.result.resultType).toBe("complete")
    expect(d.json.result.supportedVersions).toContain(MODERN)
    const l = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: meta }, h("tools/list"))
    expect(l.status).toBe(200)
    expect(l.json.result.tools.length).toBeGreaterThan(5)
    const bad = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: meta }, { "mcp-protocol-version": MODERN })
    expect(bad.status).toBe(400)
    expect(bad.json.error.code).toBe(-32020)
  })

  test("a notification gets 202 and no body; ping answers an empty result", async () => {
    const n = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })
    expect(n.status).toBe(202)
    expect(n.text).toBe("")
    const p = await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })
    expect(p.json).toEqual({ jsonrpc: "2.0", id: 3, result: {} })
  })

  let tools: Array<{ name: string; description: string; inputSchema: any; annotations?: any }> = []

  test("tools/list: unique legal names, descriptions, valid object schemas, read-only annotations on the reads", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    expect(r.status).toBe(200)
    tools = r.json.result.tools
    expect(tools.length).toBeGreaterThanOrEqual(10)
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const want of ["list_projects", "get_portfolio", "get_context", "list_records", "get_record", "get_history", "search", "fetch", "check_change", "propose_change"]) expect(names).toContain(want)
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe("object")
      // the schema is itself valid JSON Schema (ajv checks it against the JSON Schema meta-schema)
      expect(ajv.validateSchema(t.inputSchema)).toBe(true)
      expect(Array.isArray(t.inputSchema.required ?? [])).toBe(true)
    }
    for (const read of ["list_projects", "get_portfolio", "get_context", "list_records", "get_record", "get_history", "search", "fetch"]) {
      expect(tools.find((t) => t.name === read)?.annotations?.readOnlyHint).toBe(true)
    }
  })

  test("tools/call list_projects returns the same projects as REST /projects, as text content", async () => {
    const mcp = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_projects", arguments: {} } })
    expect(mcp.status).toBe(200)
    expect(mcp.json.result.isError).toBeFalsy()
    expect(mcp.json.result.content[0].type).toBe("text")
    const viaMcp = JSON.parse(mcp.json.result.content[0].text)
    const rest = await call(`${link.url}/projects`, { headers: jsonHeaders })
    expect(rest.status).toBe(200)
    expect(viaMcp.total).toBe(rest.json.total)
    expect(viaMcp.projects.map((p: any) => p.id)).toEqual(rest.json.projects.map((p: any) => p.id))
    expect(viaMcp.acting_for.role).toBe("client_viewer")
  })

  test("get_portfolio and get_context(project) answer with content", async () => {
    const pf = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_portfolio", arguments: {} } })
    expect(pf.json.result.isError).toBeFalsy()
    expect(pf.json.result.content[0].text.length).toBeGreaterThan(20)
    const list = JSON.parse((await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_projects", arguments: { limit: 1 } } })).json.result.content[0].text)
    const ctx = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_context", arguments: { project: list.projects[0].id } } })
    expect(ctx.json.result.isError).toBeFalsy()
    expect(JSON.parse(ctx.json.result.content[0].text).project.id).toBe(list.projects[0].id)
  })

  test("a project of another organisation is an error result, never data", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_context", arguments: { project: await foreignProjectId() } } })
    expect(r.status).toBe(200)
    expect(r.json.result.isError).toBe(true)
    expect(r.json.result.content[0].text).toContain("404")
  })

  test("errors are JSON-RPC errors: unknown tool -32602, unknown method -32601, malformed JSON -32700 with HTTP 400", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "no_such_tool", arguments: {} } })).json.error.code).toBe(-32602)
    expect((await rpc({ jsonrpc: "2.0", id: 13, method: "nope/nothing" })).json.error.code).toBe(-32601)
    const bad = await rpc("{not json")
    expect(bad.status).toBe(400)
    expect(bad.json.error.code).toBe(-32700)
    expect(bad.json.id).toBeNull()
  })

  test("a legacy batch is answered as a batch, in order; GET on the MCP path is 405", async () => {
    const b = await rpc([{ jsonrpc: "2.0", id: "x", method: "ping" }, { jsonrpc: "2.0", id: "y", method: "tools/list" }])
    expect(b.status).toBe(200)
    expect(b.json.map((e: any) => e.id)).toEqual(["x", "y"])
    expect(b.json[1].result.tools.length).toBeGreaterThan(5)
    const g = await call(`${link.url}/mcp`, { headers: { accept: "application/json" } })
    expect(g.status).toBe(405)
  })

  test("the same endpoint answers at /mcp, and the link in the path is the only credential", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, {}, `${link.url}/mcp`)
    expect(r.json.result).toEqual({})
    // no credential at all, or a made-up token: refused, never answered with data (404 for a malformed token, 410 for an unknown live-shaped one)
    const none = await call(`${AWL_BASE}/header`, { method: "POST", idempotent: true, headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
    expect([400, 401, 403, 404, 410]).toContain(none.status)
    expect(none.text).not.toContain("list_projects")
    const fake = await call(`${AWL_BASE}/pxa_${"0".repeat(64)}`, { method: "POST", idempotent: true, headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
    expect([404, 410]).toContain(fake.status)
    expect(fake.text).not.toContain("list_projects")
  })

  test("after the link is revoked the MCP endpoint refuses it (410)", async () => {
    await revoke(link.id)
    expect(await linkStatus(link.id)).toBe("revoked")
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    expect(r.status).toBe(410)
    expect(r.text).not.toContain("list_projects")
  }, 240_000)
})
