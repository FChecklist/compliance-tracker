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

// CRR-158 (OAuth scope allow-list gate, owner ruling 28 Aug 2026 --
// platform.claude_log id 127): evaluateToolkitScopes/classifyConnectorAction
// Category/evaluateConnectorGate are all pure -- no network, no DB -- so
// they're tested directly against fixture scope lists here, same style as
// the executeAction tests above test the real Composio-facing half of this
// file. connector-scope-gate-service.test.ts covers the DB-touching
// execution wrapper (mocked executeAction/logActivity) built on top of
// evaluateConnectorGate, per this repo's "never a live DB from a .test.ts
// file" discipline.
import {
  evaluateToolkitScopes,
  classifyConnectorActionCategory,
  evaluateConnectorGate,
  getAuthConfigScopes,
  GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST,
  KNOWN_DELETE_CAPABLE_SCOPES,
} from "./composio-connectors"

describe("evaluateToolkitScopes -- CRR-158 allow-list comparison", () => {
  test("passes when every requested scope is on the toolkit's recorded allow-list", () => {
    const result = evaluateToolkitScopes("gmail", [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ])
    expect(result.pass).toBe(true)
    expect(result.violations).toEqual([])
  })

  test("fails on a scope absent from the recorded allow-list", () => {
    const result = evaluateToolkitScopes("gmail", ["https://www.googleapis.com/auth/gmail.metadata"])
    expect(result.pass).toBe(false)
    expect(result.violations).toEqual([
      expect.objectContaining({ type: "not_allow_listed", scope: "https://www.googleapis.com/auth/gmail.metadata" }),
    ])
  })

  test("fails on a known delete-capable scope even though it would technically also cover read/write", () => {
    const result = evaluateToolkitScopes("googledrive", ["https://www.googleapis.com/auth/drive"])
    expect(result.pass).toBe(false)
    expect(result.violations).toEqual([
      expect.objectContaining({ type: "delete_scope", scope: "https://www.googleapis.com/auth/drive" }),
    ])
  })

  test("fails on the Gmail full-mailbox scope specifically", () => {
    const result = evaluateToolkitScopes("gmail", ["https://mail.google.com/"])
    expect(result.pass).toBe(false)
    expect(result.violations[0]?.type).toBe("delete_scope")
  })

  test("fails closed for a toolkit with no recorded allow-list (e.g. slack) -- nothing recorded means nothing permitted", () => {
    const result = evaluateToolkitScopes("slack", ["channels:read"])
    expect(result.pass).toBe(false)
    expect(result.violations[0]?.type).toBe("no_allow_list_recorded")
  })

  test("passes for a toolkit with no recorded allow-list when it requests zero scopes", () => {
    const result = evaluateToolkitScopes("slack", [])
    expect(result.pass).toBe(true)
  })

  test("every Google Sheets/Docs edit+write scope from the owner ruling is present on the allow-list", () => {
    expect(GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST.googlesheets?.map((e) => e.scope)).toContain(
      "https://www.googleapis.com/auth/spreadsheets"
    )
    expect(GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST.googledocs?.map((e) => e.scope)).toContain(
      "https://www.googleapis.com/auth/documents"
    )
  })

  test("KNOWN_DELETE_CAPABLE_SCOPES never overlaps any recorded allow-list entry", () => {
    for (const [, entries] of Object.entries(GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST)) {
      for (const entry of entries ?? []) {
        expect(KNOWN_DELETE_CAPABLE_SCOPES.has(entry.scope)).toBe(false)
      }
    }
  })
})

describe("classifyConnectorActionCategory -- CRR-158 action classification", () => {
  const cases: Array<[string, ReturnType<typeof classifyConnectorActionCategory>]> = [
    ["GMAIL_FETCH_EMAILS", "read"],
    ["GOOGLEDRIVE_FIND_FILE", "read"],
    ["GMAIL_SEND_EMAIL", "write"],
    ["GOOGLEDRIVE_UPLOAD_FILE", "write"],
    ["GMAIL_MODIFY_THREAD_LABELS", "edit"],
    ["GOOGLESHEETS_BATCH_UPDATE", "edit"],
    ["GMAIL_DELETE_MESSAGE", "delete"],
    ["GOOGLEDRIVE_TRASH_FILE", "delete"],
    ["GOOGLEDRIVE_PERMANENTLY_DELETE_FILE", "delete"],
  ]
  for (const [slug, expected] of cases) {
    test(`classifies ${slug} as ${expected}`, () => {
      expect(classifyConnectorActionCategory(slug)).toBe(expected)
    })
  }
})

describe("evaluateConnectorGate -- CRR-158 combined pure gate decision", () => {
  test("PASS: an allow-listed write scope + a write action + an audit descriptor", () => {
    const verdict = evaluateConnectorGate({
      toolkit: "gmail",
      actionSlug: "GMAIL_SEND_EMAIL",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.send"],
      audit: { orgId: "org_1", entityType: "gmail_message", entityId: "msg_1" },
    })
    expect(verdict.allowed).toBe(true)
    expect(verdict.category).toBe("write")
    expect(verdict.violations).toEqual([])
  })

  test("PASS: a read action never needs an audit descriptor", () => {
    const verdict = evaluateConnectorGate({
      toolkit: "gmail",
      actionSlug: "GMAIL_FETCH_EMAILS",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    })
    expect(verdict.allowed).toBe(true)
  })

  test("FAIL: scope outside the allow-list", () => {
    const verdict = evaluateConnectorGate({
      toolkit: "googledrive",
      actionSlug: "GOOGLEDRIVE_FIND_FILE",
      requestedScopes: ["https://www.googleapis.com/auth/drive.appdata"],
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.violations.some((v) => v.type === "not_allow_listed")).toBe(true)
  })

  test("FAIL: a delete-category action is refused unconditionally, even with an otherwise-allow-listed scope", () => {
    const verdict = evaluateConnectorGate({
      toolkit: "gmail",
      actionSlug: "GMAIL_DELETE_MESSAGE",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
      audit: { orgId: "org_1", entityType: "gmail_message", entityId: "msg_1" },
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.violations.some((v) => v.type === "delete_scope")).toBe(true)
  })

  test("FAIL: a write action with an allow-listed scope but no audit descriptor", () => {
    const verdict = evaluateConnectorGate({
      toolkit: "gmail",
      actionSlug: "GMAIL_SEND_EMAIL",
      requestedScopes: ["https://www.googleapis.com/auth/gmail.send"],
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.violations).toEqual([expect.objectContaining({ type: "write_action_missing_audit" })])
  })
})

describe("getAuthConfigScopes -- live 'record the exact OAuth scopes requested in auth_config' fetch", () => {
  test("GETs /auth_configs/{id} and returns the scopes array", async () => {
    let capturedUrl: string | undefined
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"] }) }
    }) as unknown as typeof fetch

    const scopes = await getAuthConfigScopes("gmail")
    expect(capturedUrl).toBe("https://backend.composio.dev/api/v3/auth_configs/ac_011eZbN9n-gT")
    expect(scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"])
  })

  test("parses a nested data.scopes shape as a fallback", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: { scopes: "https://www.googleapis.com/auth/drive.readonly, https://www.googleapis.com/auth/drive.file" } }),
    })) as unknown as typeof fetch

    const scopes = await getAuthConfigScopes("googledrive")
    expect(scopes).toEqual(["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"])
  })

  test("returns an empty array rather than throwing on an unrecognised response shape", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
    const scopes = await getAuthConfigScopes("googlesheets")
    expect(scopes).toEqual([])
  })
})
