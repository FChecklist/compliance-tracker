/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46b1 (register row BR-482, AWL-S10; spec section 8, harness H05 and H06): the OpenAPI 3.0.3 and Swagger 2.0 documents
// of the universal AI work link, served by the REAL handler from supabase/functions/ai-work-link/openapi.ts. The documents are valid JSON,
// the server URL is the link, no document declares a token as a query parameter, a function path has POST and nothing else, every
// record kind has its path with its own filter allow-list, and NO documented path is one the router does not answer (each path and
// method is sent through the handler), while every route the router answers is documented.
// Run: bun test --isolate src/lib/services/ai-work-link-openapi.test.ts
import { describe, test, expect } from "bun:test"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { ENDPOINTS, KIND_NAMES, RECORD_KINDS, TOOLS } from "../../../supabase/functions/ai-work-link/api-definition"
import { buildOpenApi, buildSwagger, operations } from "../../../supabase/functions/ai-work-link/openapi"
import { F, TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const fake = makeFake({ writesEnabled: true })
const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig() })
const BASE = `${F}/${TOKENS.manager}`
const get = async (path: string, init: Parameters<typeof req>[1] = {}) => { const r = await run(`/${TOKENS.manager}${path}`, init); return { r, doc: JSON.parse(await r.text()) } }

type Doc = { paths: Record<string, Record<string, any>>; [k: string]: any }
const METHODS = ["get", "post", "put", "patch", "delete", "options", "head"]
const allOps = (d: Doc) => Object.entries(d.paths).flatMap(([p, item]) => Object.entries(item).filter(([m]) => METHODS.includes(m)).map(([m, op]) => ({ path: p, method: m, op })))

describe("OpenAPI 3.0.3", () => {
  test("is served as JSON with no Accept header, valid, well under 1 MB, and its server URL is the pasted link", async () => {
    const r = await run(`/${TOKENS.manager}/openapi.json`)
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8")
    const text = await r.text()
    expect(text.length).toBeLessThan(1_000_000)
    const doc = JSON.parse(text)
    expect(doc.openapi).toBe("3.0.3")
    expect(doc.info.title).toContain("PROJEXA")
    expect(doc.servers).toEqual([{ url: BASE }])
    // path mode: no security scheme, and the token sits only in the server URL
    expect(doc.security).toBeUndefined()
    expect(doc.components.securitySchemes).toBeUndefined()
    expect(text.split(TOKENS.manager).length - 1).toBe(1)
    for (const p of ["/context", "/records/{kind}", "/records/{kind}/{id}", "/check", "/actions", "/drafts", "/functions", "/functions/{fn}", "/history", "/propose", "/intents/{id}", "/mcp", "/card.md", "/card-data.md"]) expect(doc.paths[p]).toBeDefined()
  })

  test("header mode: the servers point at F/header, two header schemes are declared, and the body holds no token", async () => {
    const viaQuery = await get("/openapi.json?mode=header")
    expect(viaQuery.doc.servers).toEqual([{ url: `${F}/header` }])
    const viaHeaderLink = JSON.parse(await (await run("/header/openapi.json", { headers: { "link-token": TOKENS.manager } })).text())
    for (const d of [viaQuery.doc, viaHeaderLink]) {
      expect(d.components.securitySchemes.linkToken).toEqual({ type: "apiKey", in: "header", name: "Link-Token" })
      expect(d.components.securitySchemes.bearer).toEqual({ type: "http", scheme: "bearer" })
      expect(d.security).toEqual([{ linkToken: [] }, { bearer: [] }])
      expect(JSON.stringify(d)).not.toContain("pxa_")
      // no X- prefix on the header name (a Copilot Studio fault, spec 3.3)
      expect(d.components.securitySchemes.linkToken.name.toLowerCase().startsWith("x-")).toBe(false)
    }
  })

  test("no operation declares a token as a query parameter, in either document and either mode", () => {
    for (const mode of ["path", "header"] as const) {
      for (const d of [buildOpenApi({ base: BASE, mode }), buildSwagger({ base: BASE, mode })] as Doc[]) {
        for (const { op } of allOps(d)) for (const p of op.parameters ?? []) expect(["token", "key", "api_key", "apikey"].includes(String(p.name).toLowerCase()) && p.in === "query").toBe(false)
      }
    }
  })

  test("a function path has POST only: no GET operation exists on any /functions/... path (audit A-01)", () => {
    for (const d of [buildOpenApi({ base: BASE, mode: "path" }), buildSwagger({ base: BASE, mode: "path" })] as Doc[]) {
      expect(Object.keys(d.paths["/functions/{fn}"])).toEqual(["post"])
      for (const [path, item] of Object.entries(d.paths)) if (path.startsWith("/functions/")) expect("get" in item).toBe(false)
      expect(d.paths["/actions"].post).toBeDefined()
      expect(d.paths["/actions"].get).toBeUndefined()
    }
  })

  test("operationIds are unique and at most 64 characters; every operation has answers and a summary", () => {
    const d = buildOpenApi({ base: BASE, mode: "path" }) as Doc
    const ids = allOps(d).map((o) => o.op.operationId as string)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64)
    for (const { op } of allOps(d)) {
      expect(op.summary.length).toBeGreaterThan(5)
      expect(op.responses["200"]).toBeDefined()
      expect(op.responses["410"]).toBeDefined()
    }
  })

  test("every one of the 13 record kinds has its own path, with exactly its own filters and sort list", () => {
    const d = buildOpenApi({ base: BASE, mode: "path" }) as Doc
    expect(KIND_NAMES).toHaveLength(13)
    expect(d.paths["/records/{kind}"].get.parameters.find((p: any) => p.name === "kind").schema.enum).toEqual([...KIND_NAMES])
    for (const k of RECORD_KINDS) {
      const op = d.paths[`/records/${k.kind}`]?.get
      expect(op).toBeDefined()
      const names = op.parameters.map((p: any) => p.name).filter((n: string) => !["after", "limit", "format", "sort"].includes(n)).sort()
      const want = Object.entries(k.filters.fields).flatMap(([f, def]) => def.ops.map((o) => `${f}_${o}`)).sort()
      expect(names).toEqual(want)
      const sort = op.parameters.find((p: any) => p.name === "sort")
      if (k.filters.sort.length) for (const s of k.filters.sort) expect(sort.description).toContain(s)
      else expect(sort).toBeUndefined()
      expect(op.responses["200"].content["text/csv"]).toBeDefined()
    }
  })

  test("the description names every MCP tool, and POST bodies carry an example", () => {
    const d = buildOpenApi({ base: BASE, mode: "path" }) as Doc
    for (const t of TOOLS) expect(d.info.description).toContain(t.name)
    for (const p of ["/check", "/actions", "/drafts", "/functions/{fn}"]) {
      expect(d.paths[p].post.requestBody.content["application/json"].example).toBeDefined()
    }
  })
})

describe("no documented path is one the router does not answer, and every routed path is documented", () => {
  const SAMPLE: Record<string, { method: string; path: string; body?: unknown }> = {}
  for (const { path, method } of operations()) {
    const filled = path.replace("{kind}", "boq_lines").replace("{id}", path.startsWith("/intents") ? "int_1" : "boq_lines-a001").replace("{fn}", "get_construction_project_dashboard")
    const body = path === "/check" ? { function: "record_work_progress", params: {} } : path === "/actions" ? { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } }
      : path === "/drafts" ? { function: "create_meeting", params: { title: "x", scheduledAt: "2026-10-01T10:00:00Z" } } : path === "/functions/{fn}" ? {}
      : path === "/" || path === "/mcp" ? { jsonrpc: "2.0", id: 1, method: "ping" } : undefined
    SAMPLE[`${method} ${path}`] = { method: method.toUpperCase(), path: filled, body }
  }

  test("each (path, method) of the OpenAPI document reaches a handler branch: never 404 or 405", async () => {
    const d = buildOpenApi({ base: BASE, mode: "path" }) as Doc
    let n = 0
    for (const { path, method } of allOps(d)) {
      const s = SAMPLE[`${method} ${path}`]
      const r = await run(`/${TOKENS.manager}${s.path}`, { method: s.method, body: s.body, headers: { accept: s.method === "POST" ? "application/json, text/event-stream" : "application/json" } })
      expect(`${method} ${path} -> ${r.status}`).not.toMatch(/-> (404|405)$/)
      n++
    }
    expect(n).toBeGreaterThan(30)
  })

  test("each (path, method) of the Swagger document is the same set as the OpenAPI document's", () => {
    const a = allOps(buildOpenApi({ base: BASE, mode: "path" }) as Doc).map((o) => `${o.method} ${o.path} ${o.op.operationId}`).sort()
    const b = allOps(buildSwagger({ base: BASE, mode: "path" }) as Doc).map((o) => `${o.method} ${o.path} ${o.op.operationId}`).sort()
    expect(b).toEqual(a)
  })

  test("every endpoint of the API definition is documented with its method, and a made-up path or method is not", async () => {
    const d = buildOpenApi({ base: BASE, mode: "path" }) as Doc
    for (const e of ENDPOINTS) for (const m of e.methods) expect(d.paths[e.path]?.[m.toLowerCase()]).toBeDefined()
    // the routes the handler answers with 404 or 405 are not in the document
    for (const [path, method] of [["/actions", "get"], ["/mcp", "get"], ["/nosuch", "get"], ["/records/{kind}", "post"], ["/functions", "post"]] as const) expect(d.paths[path]?.[method]).toBeUndefined()
    for (const [path, method] of [["/nosuch", "GET"], ["/actions", "GET"], ["/mcp", "GET"], ["/functions", "POST"]] as const) {
      const r = await run(`/${TOKENS.manager}${path}`, { method, body: method === "POST" ? {} : undefined })
      expect([404, 405]).toContain(r.status)
    }
  })
})

describe("Swagger 2.0", () => {
  test("host, basePath and schemes rebuild the link base; header mode rebuilds F/header", async () => {
    const { r, doc } = await get("/swagger.json")
    expect(r.status).toBe(200)
    expect(doc.swagger).toBe("2.0")
    expect(`${doc.schemes[0]}://${doc.host}${doc.basePath}`).toBe(BASE)
    expect(doc.securityDefinitions).toBeUndefined()
    const header = (await get("/swagger.json?mode=header")).doc
    expect(`${header.schemes[0]}://${header.host}${header.basePath}`).toBe(`${F}/header`)
    expect(header.securityDefinitions.linkToken).toEqual({ type: "apiKey", in: "header", name: "Link-Token" })
    expect(header.securityDefinitions.bearer.name).toBe("Authorization")
    expect(JSON.stringify(header)).not.toContain("pxa_")
    expect(JSON.stringify(doc).length).toBeLessThan(1_000_000)
  })

  test("parameters use Swagger 2.0 types, POST bodies are `in: body`, and the error definition exists", () => {
    const d = buildSwagger({ base: BASE, mode: "path" }) as Doc
    for (const { op } of allOps(d)) {
      for (const p of op.parameters ?? []) {
        expect(["query", "path", "body"]).toContain(p.in)
        if (p.in !== "body") expect(["string", "integer"]).toContain(p.type)
      }
    }
    expect(d.paths["/check"].post.parameters.find((p: any) => p.in === "body")).toBeDefined()
    expect(d.definitions.Error.required).toEqual(["error", "status"])
  })
})
