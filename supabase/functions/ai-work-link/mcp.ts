// PROJEXA-BUILD-001 U-46b1 (spec sections 4.2, 7.1 to 7.4): the MCP layer of the link, both protocol eras on ONE endpoint, stateless.
// PURE: no Deno global, no database client. The link has already been checked (a bad or revoked token is 410, and a malformed one 404,
// BEFORE this file parses any JSON-RPC: section 7.4, never 401 and never WWW-Authenticate). What arrives here is a live link and a set of
// bound reads (reads.ts), so a tool returns the same redacted rows /records does.
//
// ERAS
//   modern (2026-07-28): recognised by params._meta["io.modelcontextprotocol/protocolVersion"]. MCP-Protocol-Version must equal it, Mcp-Method
//     must equal the method, and Mcp-Name must equal the tool name on tools/call (a non-ASCII name arrives as =?base64?...?=, decoded
//     first; that sentinel form is taken from the MCP header proposal and is UNVERIFIED against the vendor page). A mismatch or a missing
//     header is HTTP 400 with -32020; an unknown version is 400 with -32022 and data.supported; an unknown method is 404 with -32601.
//     server/discover is implemented. Results carry "resultType": "complete".
//   legacy (2025-11-25 and earlier): an initialize request, or no MCP-Protocol-Version header. No Mcp-Session-Id is ever minted or echoed.
//     A notification is 202 with no body. An unknown method is a JSON-RPC -32601 error in a 200.
// A GET is 405 with Allow: POST (decided by the router). The old HTTP+SSE transport is not served.
//
// ORIGIN (section 4.2): valid means no Origin header, or any https:// origin. Anything else is 403 with a JSON-RPC error that has no id.
// TOOLS come from api-definition.ts TOOLS, the list the OpenAPI document and the manual describe: advertised is implemented.
import { LIMITS, cleanText, redactToken } from "../_shared/ai-link/core.ts"
import { MCP_INSTRUCTIONS, MCP_LEGACY, MCP_MODERN, MCP_SUPPORTED, TOOLS, toolDef } from "./api-definition.ts"
import { AwlError, type Proposal, type CheckResult, type RecordsPage, type SearchHit } from "./reads.ts"

const META_VERSION = "io.modelcontextprotocol/protocolVersion"
const META_SERVER = "io.modelcontextprotocol/serverInfo"
const SERVER_INFO = { name: "PROJEXA work link", version: "1" }

export type McpReads = {
  context(): Promise<Record<string, unknown>>
  records(kind: string, params: URLSearchParams): Promise<RecordsPage>
  record(kind: string, id: string): Promise<Record<string, unknown>>
  history(limit: string | null): Promise<Record<string, unknown>>
  search(query: string): Promise<{ results: SearchHit[]; note: string }>
  fetch(id: string): Promise<SearchHit>
  check(fn: unknown, params: unknown): CheckResult
  propose(fn: string, params: Record<string, unknown>): Proposal
}

export type McpInput = { headers: { get(name: string): string | null }; bodyText: string }
export type McpResponse = { status: number; body: unknown | null }

type Id = string | number | null

function rpcResult(id: Id, result: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result }
}

function rpcError(id: Id | undefined, code: number, message: string, data?: unknown): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message }
  if (data !== undefined) error.data = data
  // A message without an id (a parse fault, a refused Origin) carries no `id` member at all.
  return id === undefined ? { jsonrpc: "2.0", error } : { jsonrpc: "2.0", id, error }
}

/** Section 4.2: absent, or an https:// origin. */
export function originAllowed(origin: string | null): boolean {
  if (origin === null || origin === "") return true
  try {
    return new URL(origin).protocol === "https:"
  } catch {
    return false
  }
}

/** A header value, with the =?base64?...?= sentinel decoded when it carries one. */
export function decodeHeaderValue(value: string): string {
  const m = /^=\?base64\?([A-Za-z0-9+/=_-]+)\?=$/.exec(value.trim())
  if (!m) return value.trim()
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return value.trim()
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------------------------------------------

/** get_context and list_records results never carry the link address (`base`, `next`): the caller already holds it, and next_after is enough to page. */
function withoutLinkUrls(doc: Record<string, unknown>): Record<string, unknown> {
  const out = { ...doc }
  delete out.base
  delete out.next
  return out
}

function toolText(structured: Record<string, unknown>): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, isError: false }
}

function toolError(text: string): Record<string, unknown> {
  return { content: [{ type: "text", text: cleanText(redactToken(text), 500) }], isError: true }
}

function errorText(e: AwlError): string {
  return `${e.status}: ${e.body.error}${e.body.hint ? ` ${e.body.hint}` : ""}${e.body.missing?.length ? ` Missing: ${e.body.missing.join(", ")}.` : ""}`
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function runTool(name: string, args: Record<string, unknown>, reads: McpReads): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "get_context":
        return toolText(withoutLinkUrls(await reads.context()))
      case "list_records": {
        const kind = typeof args.kind === "string" ? args.kind : ""
        const q = new URLSearchParams()
        if (typeof args.after === "string" && args.after) q.set("after", args.after)
        if (args.limit !== undefined) q.set("limit", String(args.limit))
        if (typeof args.sort === "string" && args.sort) q.set("sort", args.sort)
        for (const [k, v] of Object.entries(asObject(args.filters))) q.set(k, String(v))
        return toolText(withoutLinkUrls(await reads.records(kind, q) as unknown as Record<string, unknown>))
      }
      case "get_record":
        return toolText(await reads.record(typeof args.kind === "string" ? args.kind : "", typeof args.id === "string" ? args.id : ""))
      case "get_history":
        return toolText(await reads.history(args.limit === undefined ? null : String(args.limit)))
      case "search": {
        const found = await reads.search(typeof args.query === "string" ? args.query : "")
        return toolText({ results: found.results, note: found.note })
      }
      case "fetch":
        return toolText(await reads.fetch(typeof args.id === "string" ? args.id : "") as unknown as Record<string, unknown>)
      case "check_change":
        return toolText(reads.check(args.function, args.params) as unknown as Record<string, unknown>)
      case "propose_change": {
        const fn = typeof args.function === "string" ? args.function : ""
        return toolText(reads.propose(fn, asObject(args.params)) as unknown as Record<string, unknown>)
      }
      default:
        return toolError(`Unknown tool ${name}.`)
    }
  } catch (e) {
    if (e instanceof AwlError) return toolError(errorText(e))
    return toolError("500: Something failed on our side. Try again in a minute.")
  }
}

export function toolList(): Array<Record<string, unknown>> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }))
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------------------------------------------

type One = { status: number; body: unknown | null }

async function dispatch(msg: Record<string, unknown>, headers: McpInput["headers"], reads: McpReads): Promise<One> {
  const hasId = "id" in msg && msg.id !== undefined
  const id = (hasId ? msg.id : null) as Id
  const method = typeof msg.method === "string" ? msg.method : ""
  if (msg.jsonrpc !== "2.0" || !method) return { status: 400, body: rpcError(hasId ? id : null, -32600, "Invalid Request") }
  const params = asObject(msg.params)
  const meta = asObject(params._meta)
  const version = meta[META_VERSION]
  const headerVersion = headers.get("mcp-protocol-version")

  if (typeof version === "string") {
    if (headerVersion !== version || headers.get("mcp-method") !== method) return { status: 400, body: rpcError(id, -32020, "HeaderMismatch: MCP-Protocol-Version and Mcp-Method must equal the request body") }
    if (method === "tools/call") {
      const named = headers.get("mcp-name")
      if (named === null || decodeHeaderValue(named) !== String(params.name ?? "")) return { status: 400, body: rpcError(id, -32020, "HeaderMismatch: Mcp-Name must equal the tool name") }
    }
    if (version !== MCP_MODERN) return { status: 400, body: rpcError(id, -32022, "Unsupported protocol version", { supported: [...MCP_SUPPORTED], requested: version }) }
    switch (method) {
      case "server/discover":
        return { status: 200, body: rpcResult(id, { resultType: "complete", supportedVersions: [...MCP_SUPPORTED], capabilities: { tools: {} }, _meta: { [META_SERVER]: SERVER_INFO }, instructions: MCP_INSTRUCTIONS }) }
      case "tools/list":
        return { status: 200, body: rpcResult(id, { resultType: "complete", tools: toolList() }) }
      case "tools/call": {
        if (!toolDef(String(params.name ?? ""))) return { status: 200, body: rpcError(id, -32602, "Unknown tool") }
        return { status: 200, body: rpcResult(id, { ...(await runTool(String(params.name), asObject(params.arguments), reads)), resultType: "complete" }) }
      }
      case "ping":
        return { status: 200, body: rpcResult(id, { resultType: "complete" }) }
      default:
        if (method.startsWith("notifications/") || !hasId) return { status: 202, body: null }
        return { status: 404, body: rpcError(id, -32601, "Method not found") }
    }
  }

  // Legacy era. A header that names the modern version while the body carries no _meta is a mismatch, not a legacy call.
  if (headerVersion === MCP_MODERN) return { status: 400, body: rpcError(hasId ? id : null, -32020, "HeaderMismatch: the body carries no _meta protocolVersion") }
  if (method.startsWith("notifications/") || !hasId) return { status: 202, body: null }
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      const chosen = MCP_LEGACY.includes(asked) ? asked : MCP_LEGACY[0]
      return { status: 200, body: rpcResult(id, { protocolVersion: chosen, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: MCP_INSTRUCTIONS }) }
    }
    case "ping":
      return { status: 200, body: rpcResult(id, {}) }
    case "tools/list":
      return { status: 200, body: rpcResult(id, { tools: toolList() }) }
    case "tools/call": {
      if (!toolDef(String(params.name ?? ""))) return { status: 200, body: rpcError(id, -32602, "Unknown tool") }
      return { status: 200, body: rpcResult(id, await runTool(String(params.name), asObject(params.arguments), reads)) }
    }
    default:
      return { status: 200, body: rpcError(id, -32601, "Method not found") }
  }
}

/**
 * One POST to the MCP endpoint. The Origin rule and the body limit come first, then the JSON-RPC parse, then the era. A batch (a JSON
 * array) is served for the legacy era only. Notifications are 202 with no body.
 */
export async function handleMcp(input: McpInput, reads: McpReads): Promise<McpResponse> {
  if (!originAllowed(input.headers.get("origin"))) return { status: 403, body: rpcError(undefined, -32600, "Origin not allowed") }
  if (new TextEncoder().encode(input.bodyText).length > LIMITS.bodyMaxBytes) return { status: 413, body: rpcError(null, -32600, "Request body is over 8 KB") }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.bodyText || "null")
  } catch {
    return { status: 400, body: rpcError(null, -32700, "Parse error") }
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { status: 400, body: rpcError(null, -32600, "Invalid Request") }
    if (parsed.some((m) => typeof asObject(asObject(asObject(m).params)._meta)[META_VERSION] === "string")) {
      return { status: 400, body: rpcError(null, -32600, "Batches are not part of protocol 2026-07-28") }
    }
    const out: unknown[] = []
    for (const m of parsed) {
      const r = await dispatch(asObject(m), input.headers, reads)
      if (r.body !== null) out.push(r.body)
    }
    return out.length ? { status: 200, body: out } : { status: 202, body: null }
  }
  if (!parsed || typeof parsed !== "object") return { status: 400, body: rpcError(null, -32600, "Invalid Request") }
  return dispatch(parsed as Record<string, unknown>, input.headers, reads)
}
