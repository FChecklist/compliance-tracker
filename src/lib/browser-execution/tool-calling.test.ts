/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 2: real round-trip tests for
// engine-browser-mcp + engine-browser-function -- a real tool is registered,
// really executed (no stubbed handler return), and the JSON-RPC envelope
// really reflects that execution's result.
import { describe, expect, test } from "bun:test"
import {
  BrowserToolRegistry,
  dispatchMcpToolCall,
  parseModelToolCall,
  type McpToolCallRequest,
} from "./tool-calling"

function buildRegistry() {
  const registry = new BrowserToolRegistry()
  registry.register(
    {
      name: "get_overdue_count",
      description: "Real-ish handler: doubles the given base count (stands in for a real DB call).",
      inputSchema: { type: "object", required: ["base"], properties: { base: { type: "number" } } },
    },
    (args) => ({ overdueCount: (args.base as number) * 2 }),
  )
  return registry
}

describe("BrowserToolRegistry", () => {
  test("execute() really invokes the registered handler and returns its real result", async () => {
    const registry = buildRegistry()
    const result = await registry.execute("get_overdue_count", { base: 3 })
    expect(result).toEqual({ overdueCount: 6 })
  })

  test("execute() throws on an unregistered tool name", async () => {
    const registry = buildRegistry()
    await expect(registry.execute("nonexistent", {})).rejects.toThrow(/Unknown browser tool/)
  })

  test("list() reports every registered tool definition", () => {
    const registry = buildRegistry()
    expect(registry.list().map((t) => t.name)).toEqual(["get_overdue_count"])
  })
})

describe("dispatchMcpToolCall", () => {
  test("real round trip: a tools/call request against a real tool returns a real JSON-RPC success envelope", async () => {
    const registry = buildRegistry()
    const request: McpToolCallRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_overdue_count", arguments: { base: 5 } },
    }
    const response = await dispatchMcpToolCall(registry, request)
    expect("result" in response).toBe(true)
    if ("result" in response) {
      expect(JSON.parse(response.result.content[0].text)).toEqual({ overdueCount: 10 })
    }
  })

  test("unknown tool name -> real JSON-RPC error envelope, not a thrown exception", async () => {
    const registry = buildRegistry()
    const request: McpToolCallRequest = {
      jsonrpc: "2.0",
      id: "req-2",
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    }
    const response = await dispatchMcpToolCall(registry, request)
    expect("error" in response).toBe(true)
    if ("error" in response) {
      expect(response.error.code).toBe(-32601)
      expect(response.id).toBe("req-2")
    }
  })

  test("a handler that throws surfaces as a JSON-RPC internal-error envelope, not an unhandled rejection", async () => {
    const registry = new BrowserToolRegistry()
    registry.register(
      { name: "always_fails", description: "test-only failing tool", inputSchema: { type: "object", properties: {} } },
      () => {
        throw new Error("simulated real failure")
      },
    )
    const response = await dispatchMcpToolCall(registry, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "always_fails", arguments: {} },
    })
    expect("error" in response).toBe(true)
    if ("error" in response) {
      expect(response.error.code).toBe(-32603)
      expect(response.error.message).toContain("simulated real failure")
    }
  })
})

describe("parseModelToolCall", () => {
  test("parses a real tool_call envelope emitted by a JSON-mode model reply", () => {
    const raw = JSON.stringify({ tool_call: { name: "get_overdue_count", arguments: { base: 7 } } })
    expect(parseModelToolCall(raw)).toEqual({ name: "get_overdue_count", arguments: { base: 7 } })
  })

  test("returns null (not an error) for a plain-text reply with no tool call", () => {
    expect(parseModelToolCall("just a normal answer, no tool needed")).toBeNull()
  })

  test("returns null for well-formed JSON that isn't a tool-call envelope", () => {
    expect(parseModelToolCall(JSON.stringify({ answer: "42" }))).toBeNull()
  })
})
