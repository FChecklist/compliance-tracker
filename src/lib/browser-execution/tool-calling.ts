// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 2:
// engine-browser-mcp + engine-browser-function.
//
// This is browser-NATIVE tool-calling for the Lite LLM / Transformers
// compute tiers themselves (a locally-loaded model or embedding pipeline
// deciding to call a tool, and that tool actually running) -- NOT the
// separate BROWSER_AUTOMATION_PROFILE session-tooling scope (driving a
// browser session for an agent, e.g. Playwright-style automation), which
// the original phase_5 gap analysis already ruled a non-match for this gap
// item. It is also a distinct surface from the existing
// src/app/api/mcp/route.ts server (that one is an MCP SERVER exposing this
// app's compliance data over JSON-RPC to an external MCP client over the
// network) -- this module reuses that route's real, already-shipped
// `{name, description, inputSchema}` tool-definition shape and JSON-RPC 2.0
// envelope purely for consistency (one tool-contract shape in this
// codebase, not two), but runs entirely client-side with zero network hop:
// the "client" issuing the tools/call request is a browser-local model
// (WebLLM) or a browser-local classifier (Transformers.js), and the
// "server" handling it is this in-memory registry, not an HTTP endpoint.
//
// engine-browser-function is the real execution half (BrowserToolRegistry.
// execute -- actually invokes the registered handler and returns its real
// result, not a stub) and engine-browser-mcp is the protocol-envelope half
// (dispatchMcpToolCall -- wraps that real result in the same JSON-RPC 2.0
// success/error shape /api/mcp/route.ts's own respondSuccess/respondError
// helpers use, so any caller already speaking that convention -- server or
// browser -- can consume either).

export type BrowserToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type BrowserToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown

export type McpToolCallRequest = {
  jsonrpc: "2.0"
  id: string | number
  method: "tools/call"
  params: { name: string; arguments: Record<string, unknown> }
}

export type McpToolCallSuccess = {
  jsonrpc: "2.0"
  id: string | number
  result: { content: Array<{ type: "text"; text: string }> }
}

export type McpToolCallError = {
  jsonrpc: "2.0"
  id: string | number
  error: { code: number; message: string }
}

export type McpToolCallResponse = McpToolCallSuccess | McpToolCallError

/** Real registry of browser-native tools -- engine-browser-function's home. */
export class BrowserToolRegistry {
  private tools = new Map<string, { def: BrowserToolDefinition; handler: BrowserToolHandler }>()

  register(def: BrowserToolDefinition, handler: BrowserToolHandler): void {
    this.tools.set(def.name, { def, handler })
  }

  list(): BrowserToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.def)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * engine-browser-function: really invokes the registered handler (no
   * simulated/stubbed execution) and returns its real result. Throws if the
   * tool name is unregistered -- callers needing a non-throwing form use
   * `dispatchMcpToolCall`, which converts this into a JSON-RPC error.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.tools.get(name)
    if (!entry) throw new Error(`Unknown browser tool: "${name}"`)
    return entry.handler(args)
  }
}

const JSON_RPC_METHOD_NOT_FOUND = -32601
const JSON_RPC_INTERNAL_ERROR = -32603

/**
 * engine-browser-mcp: the real protocol envelope around a real tool
 * execution -- takes one MCP-shaped tools/call request, actually runs it
 * against `registry` (engine-browser-function), and returns a genuine
 * JSON-RPC 2.0 response, success or error, matching /api/mcp/route.ts's
 * own wire format.
 */
export async function dispatchMcpToolCall(
  registry: BrowserToolRegistry,
  request: McpToolCallRequest,
): Promise<McpToolCallResponse> {
  const { name, arguments: args } = request.params
  if (!registry.has(name)) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown tool: "${name}"` },
    }
  }
  try {
    const result = await registry.execute(name, args)
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: JSON_RPC_INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) },
    }
  }
}

export type ParsedToolCall = { name: string; arguments: Record<string, unknown> }

/**
 * Small local models (the lite-llm tier's real model, see
 * ../browser-execution/webllm-engine.ts) can't rely on WebLLM's native
 * `ChatCompletionRequest.tools` field -- that is hard-restricted by the
 * library itself to a short allowlist of 7-8B "Hermes" models
 * (`functionCallingModelIds`), which is too large for a lite/browser-first
 * tier. Instead, the model is prompted (see
 * webllm-engine.ts#buildToolCallSystemPrompt) to reply in WebLLM's
 * model-agnostic JSON mode (`response_format: {type:"json_object"}`, not
 * restricted to that allowlist) with a `{"tool_call": {"name":...,
 * "arguments":{...}}}` envelope. This parses that reply back into a real
 * `ParsedToolCall`, or returns null (honest "the model declined to call a
 * tool this turn", not an error) if the reply is not a recognizable
 * tool-call envelope, matching this codebase's "never claim success on a
 * result that isn't real" precedent (see tier-detection.ts's header).
 */
export function parseModelToolCall(rawText: string): ParsedToolCall | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || !("tool_call" in parsed)) return null
  const toolCall = (parsed as { tool_call: unknown }).tool_call
  if (typeof toolCall !== "object" || toolCall === null) return null
  const { name, arguments: args } = toolCall as { name?: unknown; arguments?: unknown }
  if (typeof name !== "string" || typeof args !== "object" || args === null) return null
  return { name, arguments: args as Record<string, unknown> }
}
