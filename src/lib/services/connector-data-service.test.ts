/// <reference types="bun-types" />
// GAP-CONNECTOR-DATA (D26.B2.S1): matches this codebase's established test
// discipline (business-object-classifier.test.ts / asset-routing-engine.
// test.ts) -- pure normalization functions are tested directly with no
// mocking, and the orchestration functions (listRecentGmailMessages/
// listRecentDriveFiles) are tested with connector-data-store.ts and
// composio-connectors.ts mock.module()'d out, so this suite never touches
// withTenantContext/a live DB or makes a real network call to Composio.
import { describe, test, expect, mock } from "bun:test"
import { ServiceError } from "./compliance-service"

// ─── Pure normalizers -- no mocking ──────────────────────────────────────

describe("normalizeGmailMessages", () => {
  test("extracts a top-level array response as-is", async () => {
    const { normalizeGmailMessages } = await import("./connector-data-service")
    expect(normalizeGmailMessages([{ id: "1" }, { id: "2" }])).toHaveLength(2)
  })

  test("extracts from a { messages: [...] } wrapper (documented shape)", async () => {
    const { normalizeGmailMessages } = await import("./connector-data-service")
    expect(normalizeGmailMessages({ messages: [{ id: "1" }] })).toEqual([{ id: "1" }])
  })

  test("extracts from a { response_data: [...] } wrapper (Composio's generic envelope)", async () => {
    const { normalizeGmailMessages } = await import("./connector-data-service")
    expect(normalizeGmailMessages({ response_data: [{ id: "1" }] })).toEqual([{ id: "1" }])
  })

  test("returns an empty array for null/undefined/unrecognised shapes -- never throws", async () => {
    const { normalizeGmailMessages } = await import("./connector-data-service")
    expect(normalizeGmailMessages(null)).toEqual([])
    expect(normalizeGmailMessages(undefined)).toEqual([])
    expect(normalizeGmailMessages("not an object")).toEqual([])
    expect(normalizeGmailMessages({ somethingElse: 1 })).toEqual([])
  })
})

describe("toGmailMessageSummary", () => {
  test("maps the documented camelCase field names", async () => {
    const { toGmailMessageSummary } = await import("./connector-data-service")
    const summary = toGmailMessageSummary({
      messageId: "m1", threadId: "t1", subject: "Hello", snippet: "preview...",
      internalDate: "1700000000000", labelIds: ["INBOX", "UNREAD"],
    })
    expect(summary.externalId).toBe("m1")
    expect(summary.threadId).toBe("t1")
    expect(summary.subject).toBe("Hello")
    expect(summary.snippet).toBe("preview...")
    expect(summary.sentAt).toEqual(new Date(1700000000000))
    expect(summary.labelIds).toEqual(["INBOX", "UNREAD"])
  })

  test("falls back to snake_case field names when camelCase is absent", async () => {
    const { toGmailMessageSummary } = await import("./connector-data-service")
    const summary = toGmailMessageSummary({ message_id: "m2", thread_id: "t2", internal_date: "1700000000000" })
    expect(summary.externalId).toBe("m2")
    expect(summary.threadId).toBe("t2")
    expect(summary.sentAt).not.toBeNull()
  })

  test("falls back to a bare 'id' when messageId/message_id are both absent", async () => {
    const { toGmailMessageSummary } = await import("./connector-data-service")
    expect(toGmailMessageSummary({ id: "m3" }).externalId).toBe("m3")
  })

  test("degrades to null/empty fields rather than throwing on a mostly-empty object", async () => {
    const { toGmailMessageSummary } = await import("./connector-data-service")
    const summary = toGmailMessageSummary({})
    expect(summary.externalId).toBe("")
    expect(summary.threadId).toBeNull()
    expect(summary.subject).toBeNull()
    expect(summary.snippet).toBeNull()
    expect(summary.sentAt).toBeNull()
    expect(summary.labelIds).toEqual([])
  })
})

describe("normalizeDriveFiles / toDriveFileSummary", () => {
  test("extracts from a { files: [...] } wrapper (documented shape)", async () => {
    const { normalizeDriveFiles } = await import("./connector-data-service")
    expect(normalizeDriveFiles({ files: [{ id: "f1" }] })).toEqual([{ id: "f1" }])
  })

  test("maps id/name/mimeType/webViewLink/modifiedTime and the first owner's email", async () => {
    const { toDriveFileSummary } = await import("./connector-data-service")
    const summary = toDriveFileSummary({
      id: "f1", name: "Q1 Budget.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      webViewLink: "https://drive.google.com/file/d/f1/view",
      owners: [{ emailAddress: "owner@example.com" }],
      modifiedTime: "2026-07-01T10:00:00.000Z",
      size: "12345",
    })
    expect(summary.externalId).toBe("f1")
    expect(summary.name).toBe("Q1 Budget.xlsx")
    expect(summary.webViewLink).toBe("https://drive.google.com/file/d/f1/view")
    expect(summary.ownerEmail).toBe("owner@example.com")
    expect(summary.modifiedAt).toEqual(new Date("2026-07-01T10:00:00.000Z"))
    expect(summary.sizeBytes).toBe(12345)
  })

  test("degrades to null fields when owners/size/modifiedTime are absent -- never throws", async () => {
    const { toDriveFileSummary } = await import("./connector-data-service")
    const summary = toDriveFileSummary({ id: "f2" })
    expect(summary.externalId).toBe("f2")
    expect(summary.ownerEmail).toBeNull()
    expect(summary.sizeBytes).toBeNull()
    expect(summary.modifiedAt).toBeNull()
  })
})

// ─── listRecentGmailMessages / listRecentDriveFiles -- store + gate mocked ──
//
// R81_F23 fix: both functions now route through connector-scope-gate-
// service.ts's executeGatedConnectorAction (CRR-158) instead of calling
// composio-connectors.ts's executeAction directly, opening a real (mocked
// here) withTenantContext transaction to supply the gate's required `tx`.
// mockGate() below stands in for a passing gate verdict -- the gate's own
// pass/fail logic is covered by connector-scope-gate-service.test.ts /
// composio-connectors.test.ts, not re-tested here; this suite only proves
// the CALL SITE wires through it correctly (right toolkit/actionSlug/scopes
// reach the gate, the gate's result shape is unwrapped correctly, a gate
// denial surfaces as ServiceError(403) via this file's existing
// ServiceError-on-failure convention).
function mockGate(impl: (params: Record<string, unknown>) => Promise<unknown>) {
  mock.module("./connector-scope-gate-service", () => ({
    executeGatedConnectorAction: mock(impl),
    ConnectorGateDeniedError: class ConnectorGateDeniedError extends Error {},
  }))
}

function mockScopes(scopes: string[] = ["some.scope"]) {
  mock.module("@/lib/composio-connectors", () => ({
    getAuthConfigScopes: mock(async () => scopes),
  }))
}

function mockTenantContext() {
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn({})),
  }))
}

describe("listRecentGmailMessages", () => {
  test("propagates ServiceError when the caller has no active gmail connection", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => { throw new ServiceError("No gmail connection found", 400) }),
      upsertConnectorDocument: mock(async () => null),
    }))
    mockScopes()
    mockTenantContext()
    mockGate(async () => ({ category: "read", auditRecorded: false, result: { successful: true, data: { messages: [] }, error: null } }))
    const { listRecentGmailMessages } = await import("./connector-data-service")

    await expect(listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })).rejects.toThrow(/No gmail connection/)
  })

  test("returns normalized messages and persists a digital-twin row per message on success", async () => {
    const upsertCalls: unknown[] = []
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-1", composioConnectedAccountId: "ca_1", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async (_ctx: unknown, connectorAccountId: unknown, input: unknown) => {
        upsertCalls.push({ connectorAccountId, input })
        return { id: "doc-1" }
      }),
    }))
    mockScopes(["https://www.googleapis.com/auth/gmail.readonly"])
    mockTenantContext()
    let capturedParams: Record<string, unknown> | undefined
    mockGate(async (params) => {
      capturedParams = params
      return {
        category: "read",
        auditRecorded: false,
        result: { successful: true, data: { messages: [{ messageId: "m1", subject: "Hi", snippet: "s", internalDate: "1700000000000" }] }, error: null },
      }
    })
    const { listRecentGmailMessages } = await import("./connector-data-service")

    const messages = await listRecentGmailMessages({ orgId: "org-1", userId: "user-1" }, { maxResults: 5 })

    expect(messages).toHaveLength(1)
    expect(messages[0]!.externalId).toBe("m1")
    expect(capturedParams?.toolkit).toBe("gmail")
    expect(capturedParams?.actionSlug).toBe("GMAIL_FETCH_EMAILS")
    expect(capturedParams?.requestedScopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"])
    expect((capturedParams?.args as { max_results: number }).max_results).toBe(5)
    expect(upsertCalls).toHaveLength(1)
    expect((upsertCalls[0] as { connectorAccountId: string }).connectorAccountId).toBe("conn-1")
  })

  test("caps maxResults at 50 and defaults to 10 when unset/invalid", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-1", composioConnectedAccountId: "ca_1", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async () => ({ id: "doc-1" })),
    }))
    mockScopes()
    mockTenantContext()
    const capturedArgsList: unknown[] = []
    mockGate(async (params) => {
      capturedArgsList.push(params.args)
      return { category: "read", auditRecorded: false, result: { successful: true, data: { messages: [] }, error: null } }
    })
    const { listRecentGmailMessages } = await import("./connector-data-service")

    await listRecentGmailMessages({ orgId: "org-1", userId: "user-1" }, { maxResults: 9999 })
    await listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })
    await listRecentGmailMessages({ orgId: "org-1", userId: "user-1" }, { maxResults: -5 })

    expect((capturedArgsList[0] as { max_results: number }).max_results).toBe(50)
    expect((capturedArgsList[1] as { max_results: number }).max_results).toBe(10)
    expect((capturedArgsList[2] as { max_results: number }).max_results).toBe(10)
  })

  test("throws ServiceError(502) when Composio reports the tool call failed", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-1", composioConnectedAccountId: "ca_1", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async () => ({ id: "doc-1" })),
    }))
    mockScopes()
    mockTenantContext()
    mockGate(async () => ({ category: "read", auditRecorded: false, result: { successful: false, data: null, error: "token expired" } }))
    const { listRecentGmailMessages, ServiceError: ReExportedServiceError } = await import("./connector-data-service")

    await expect(listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })).rejects.toBeInstanceOf(ReExportedServiceError)
    await expect(listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })).rejects.toThrow(/token expired/)
  })

  test("throws ServiceError(403) when the CRR-158 scope gate denies the call", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-1", composioConnectedAccountId: "ca_1", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async () => ({ id: "doc-1" })),
    }))
    mockScopes(["https://www.googleapis.com/auth/gmail.metadata"]) // not on the allow-list
    mockTenantContext()
    mock.module("./connector-scope-gate-service", () => {
      class ConnectorGateDeniedError extends Error {}
      return {
        executeGatedConnectorAction: mock(async () => { throw new ConnectorGateDeniedError("scope not allow-listed") }),
        ConnectorGateDeniedError,
      }
    })
    const { listRecentGmailMessages, ServiceError: ReExportedServiceError } = await import("./connector-data-service")

    await expect(listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })).rejects.toBeInstanceOf(ReExportedServiceError)
    await expect(listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })).rejects.toThrow(/CRR-158/)
  })

  test("a digital-twin persistence failure does not fail the overall data pull", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-1", composioConnectedAccountId: "ca_1", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async () => { throw new Error("db unreachable") }),
    }))
    mockScopes()
    mockTenantContext()
    mockGate(async () => ({ category: "read", auditRecorded: false, result: { successful: true, data: { messages: [{ messageId: "m1" }] }, error: null } }))
    const { listRecentGmailMessages } = await import("./connector-data-service")

    const messages = await listRecentGmailMessages({ orgId: "org-1", userId: "user-1" })
    expect(messages).toHaveLength(1) // the real data pull still succeeds and is returned
  })
})

describe("listRecentDriveFiles", () => {
  test("propagates ServiceError when the caller has no active drive connection", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => { throw new ServiceError("No googledrive connection found", 400) }),
      upsertConnectorDocument: mock(async () => null),
    }))
    mockScopes()
    mockTenantContext()
    mockGate(async () => ({ category: "read", auditRecorded: false, result: { successful: true, data: { files: [] }, error: null } }))
    const { listRecentDriveFiles } = await import("./connector-data-service")

    await expect(listRecentDriveFiles({ orgId: "org-1", userId: "user-1" })).rejects.toThrow(/No googledrive connection/)
  })

  test("returns normalized files and persists a digital-twin row per file on success", async () => {
    mock.module("./connector-data-store", () => ({
      getActiveConnectorAccount: mock(async () => ({ id: "conn-2", composioConnectedAccountId: "ca_2", status: "ACTIVE" })),
      upsertConnectorDocument: mock(async () => ({ id: "doc-2" })),
    }))
    mockScopes(["https://www.googleapis.com/auth/drive.readonly"])
    mockTenantContext()
    let capturedParams: Record<string, unknown> | undefined
    mockGate(async (params) => {
      capturedParams = params
      return {
        category: "read",
        auditRecorded: false,
        result: { successful: true, data: { files: [{ id: "f1", name: "report.pdf", mimeType: "application/pdf" }] }, error: null },
      }
    })
    const { listRecentDriveFiles } = await import("./connector-data-service")

    const files = await listRecentDriveFiles({ orgId: "org-1", userId: "user-1" })
    expect(files).toHaveLength(1)
    expect(files[0]!.externalId).toBe("f1")
    expect(files[0]!.name).toBe("report.pdf")
    expect(capturedParams?.toolkit).toBe("googledrive")
    expect(capturedParams?.actionSlug).toBe("GOOGLEDRIVE_FIND_FILE")
  })
})
