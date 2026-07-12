/// <reference types="bun-types" />
// GAP-CONNECTOR-DATA (D26.B2.S1): tests executeAction() -- the real tool-
// execution call this wave adds, distinct from initiateConnection()/
// getConnectionStatus() above it (OAuth-connection management only, already
// live before this wave). Mocks globalThis.fetch directly (this file's own
// composioFetch() is a thin wrapper over the global fetch, no separate HTTP
// client to mock) and restores it afterward so no other test file's fetch
// usage is affected.
import { describe, test, expect, beforeEach, afterEach } from "bun:test"

const realFetch = globalThis.fetch
const realApiKey = process.env.COMPOSIO_API_KEY

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = "test-composio-key"
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (realApiKey === undefined) delete process.env.COMPOSIO_API_KEY
  else process.env.COMPOSIO_API_KEY = realApiKey
})

describe("executeAction", () => {
  test("POSTs to /tools/execute/{actionSlug} with connected_account_id, user_id, and arguments", async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        json: async () => ({ successful: true, data: { messages: [] }, error: null }),
      } as Response
    }) as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    await executeAction("GMAIL_FETCH_EMAILS", "ca_123", "user_1", { max_results: 5 })

    expect(capturedUrl).toBe("https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS")
    expect(capturedInit?.method).toBe("POST")
    const body = JSON.parse(capturedInit?.body as string)
    expect(body).toEqual({ connected_account_id: "ca_123", user_id: "user_1", arguments: { max_results: 5 } })
  })

  test("returns { successful: true, data, error: null } on a successful response", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ successful: true, data: { files: [{ id: "f1" }] }, error: null }),
    })) as unknown as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    const result = await executeAction("GOOGLEDRIVE_FIND_FILE", "ca_1", "user_1")

    expect(result.successful).toBe(true)
    expect(result.data).toEqual({ files: [{ id: "f1" }] })
    expect(result.error).toBeNull()
  })

  test("normalizes the legacy 'successfull' (double-l) response spelling to successful", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ successfull: true, data: { ok: 1 }, error: null }),
    })) as unknown as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    const result = await executeAction("SOME_ACTION", "ca_1", "user_1")

    expect(result.successful).toBe(true)
  })

  test("surfaces successful: false and the error message when the tool call fails", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ successful: false, data: null, error: "invalid grant" }),
    })) as unknown as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    const result = await executeAction("GMAIL_FETCH_EMAILS", "ca_1", "user_1")

    expect(result.successful).toBe(false)
    expect(result.error).toBe("invalid grant")
  })

  test("throws when COMPOSIO_API_KEY is not configured -- never sends a keyless request", async () => {
    delete process.env.COMPOSIO_API_KEY
    let fetchWasCalled = false
    globalThis.fetch = (async () => {
      fetchWasCalled = true
      return { ok: true, json: async () => ({}) } as Response
    }) as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    await expect(executeAction("GMAIL_FETCH_EMAILS", "ca_1", "user_1")).rejects.toThrow(/COMPOSIO_API_KEY/)
    expect(fetchWasCalled).toBe(false)
  })

  test("throws with the response body on a non-2xx HTTP status", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    })) as unknown as typeof fetch

    const { executeAction } = await import("./composio-connectors")
    await expect(executeAction("GMAIL_FETCH_EMAILS", "ca_1", "user_1")).rejects.toThrow(/HTTP 401/)
  })
})
