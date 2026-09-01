// CRR-158: tests the DB/Composio-touching execution wrapper
// (executeGatedConnectorAction) built on top of composio-connectors.ts's
// pure evaluateConnectorGate() (that function's own fixture-based pass/fail
// coverage lives in composio-connectors.test.ts). Mocks @/lib/composio-
// connectors's executeAction and @/lib/audit's logActivity at the module
// boundary -- never a live DB or a live Composio call from a .test.ts file,
// matching this repo's established discipline (see approval-workflow-
// service.test.ts / prompt-governance-gates.test.ts's own notes on this).
// The real evaluateConnectorGate/evaluateToolkitScopes/
// classifyConnectorActionCategory logic is NOT mocked here -- spread from
// the actual module below -- so these tests prove the real gate genuinely
// refuses what CRR-158 requires it to refuse, not a stubbed-out verdict.
/// <reference types="bun-types" />
import { describe, test, expect, mock, afterEach } from "bun:test"
import * as actualComposioModule from "@/lib/composio-connectors"

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
const GMAIL_FULL_MAILBOX_SCOPE = "https://mail.google.com/"
const GMAIL_UNLISTED_SCOPE = "https://www.googleapis.com/auth/gmail.metadata"

const FAKE_TX = {} as never

const VALID_AUDIT = {
  orgId: "org_1",
  entityType: "gmail_message",
  entityId: "msg_1",
  dbUser: { id: "user_1", name: "Test User", role: "admin" } as never,
}

function mockExecuteAction(impl: () => Promise<{ successful: boolean; data: unknown; error: string | null }>) {
  const fn = mock(impl)
  mock.module("@/lib/composio-connectors", () => ({ ...actualComposioModule, executeAction: fn }))
  return fn
}

function mockLogActivity(impl: () => Promise<void>) {
  const fn = mock(impl)
  mock.module("@/lib/audit", () => ({ logActivity: fn }))
  return fn
}

afterEach(() => {
  mock.restore()
})

describe("executeGatedConnectorAction -- CRR-158 pass path", () => {
  test("an allow-listed write scope + a successful send + an audit descriptor: the action runs and exactly one audit row is written", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: { id: "msg_1" }, error: null }))
    const logActivityMock = mockLogActivity(async () => {})
    const { executeGatedConnectorAction } = await import("./connector-scope-gate-service")

    const result = await executeGatedConnectorAction({
      toolkit: "gmail",
      actionSlug: "GMAIL_SEND_EMAIL",
      requestedScopes: [GMAIL_SEND_SCOPE],
      composioConnectedAccountId: "ca_1",
      appUserId: "user_1",
      tx: FAKE_TX,
      audit: VALID_AUDIT,
    })

    expect(result.category).toBe("write")
    expect(result.auditRecorded).toBe(true)
    expect(executeActionMock).toHaveBeenCalledTimes(1)
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const call = logActivityMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call.action).toBe("connector.write")
    expect(call.entityId).toBe("msg_1")
    expect(call.orgId).toBe("org_1")
    expect(call.dbUser).toEqual(VALID_AUDIT.dbUser)
  })

  test("a read action needs no audit descriptor and never calls logActivity", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: { messages: [] }, error: null }))
    const logActivityMock = mockLogActivity(async () => {})
    const { executeGatedConnectorAction } = await import("./connector-scope-gate-service")

    const result = await executeGatedConnectorAction({
      toolkit: "gmail",
      actionSlug: "GMAIL_FETCH_EMAILS",
      requestedScopes: [GMAIL_READONLY_SCOPE],
      composioConnectedAccountId: "ca_1",
      appUserId: "user_1",
      tx: FAKE_TX,
    })

    expect(result.auditRecorded).toBe(false)
    expect(executeActionMock).toHaveBeenCalledTimes(1)
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  test("a write action that Composio reports as unsuccessful writes no audit row (nothing real happened to audit)", async () => {
    mockExecuteAction(async () => ({ successful: false, data: null, error: "invalid grant" }))
    const logActivityMock = mockLogActivity(async () => {})
    const { executeGatedConnectorAction } = await import("./connector-scope-gate-service")

    const result = await executeGatedConnectorAction({
      toolkit: "gmail",
      actionSlug: "GMAIL_SEND_EMAIL",
      requestedScopes: [GMAIL_SEND_SCOPE],
      composioConnectedAccountId: "ca_1",
      appUserId: "user_1",
      tx: FAKE_TX,
      audit: VALID_AUDIT,
    })

    expect(result.result.successful).toBe(false)
    expect(result.auditRecorded).toBe(false)
    expect(logActivityMock).not.toHaveBeenCalled()
  })
})

describe("executeGatedConnectorAction -- CRR-158 fail paths", () => {
  test("a scope outside the recorded allow-list is refused before Composio is ever called", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: {}, error: null }))
    mockLogActivity(async () => {})
    const { executeGatedConnectorAction, ConnectorGateDeniedError } = await import("./connector-scope-gate-service")

    await expect(
      executeGatedConnectorAction({
        toolkit: "gmail",
        actionSlug: "GMAIL_FETCH_EMAILS",
        requestedScopes: [GMAIL_UNLISTED_SCOPE],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
      })
    ).rejects.toBeInstanceOf(ConnectorGateDeniedError)
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  test("a delete-capable OAuth scope (Gmail full-mailbox) is refused even for a read action", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: {}, error: null }))
    const { executeGatedConnectorAction, ConnectorGateDeniedError } = await import("./connector-scope-gate-service")

    let caught: unknown
    try {
      await executeGatedConnectorAction({
        toolkit: "gmail",
        actionSlug: "GMAIL_FETCH_EMAILS",
        requestedScopes: [GMAIL_FULL_MAILBOX_SCOPE],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConnectorGateDeniedError)
    expect((caught as InstanceType<typeof ConnectorGateDeniedError>).violations[0]?.type).toBe("delete_scope")
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  test("a delete-category action is refused unconditionally, even with an allow-listed scope and a full audit descriptor", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: {}, error: null }))
    const { executeGatedConnectorAction, ConnectorGateDeniedError } = await import("./connector-scope-gate-service")

    await expect(
      executeGatedConnectorAction({
        toolkit: "gmail",
        actionSlug: "GMAIL_DELETE_MESSAGE",
        requestedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
        audit: VALID_AUDIT,
      })
    ).rejects.toBeInstanceOf(ConnectorGateDeniedError)
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  test("a write action with an allow-listed scope but no audit descriptor is refused before Composio is ever called", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: {}, error: null }))
    const { executeGatedConnectorAction, ConnectorGateDeniedError } = await import("./connector-scope-gate-service")

    await expect(
      executeGatedConnectorAction({
        toolkit: "gmail",
        actionSlug: "GMAIL_SEND_EMAIL",
        requestedScopes: [GMAIL_SEND_SCOPE],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
        // audit omitted deliberately
      })
    ).rejects.toBeInstanceOf(ConnectorGateDeniedError)
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  test("an unlisted toolkit (no recorded allow-list, e.g. Slack) fails closed even for a plausible-looking scope", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: {}, error: null }))
    const { executeGatedConnectorAction, ConnectorGateDeniedError } = await import("./connector-scope-gate-service")

    await expect(
      executeGatedConnectorAction({
        toolkit: "slack",
        actionSlug: "SLACK_SEND_MESSAGE",
        requestedScopes: ["chat:write"],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
        audit: VALID_AUDIT,
      })
    ).rejects.toBeInstanceOf(ConnectorGateDeniedError)
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  test("the underlying Composio write DOES happen but a failed audit write is surfaced loudly, never swallowed", async () => {
    const executeActionMock = mockExecuteAction(async () => ({ successful: true, data: { id: "msg_1" }, error: null }))
    const logActivityMock = mockLogActivity(async () => {
      throw new Error("connection to app_runtime timed out")
    })
    const { executeGatedConnectorAction, ConnectorAuditWriteFailedError } = await import("./connector-scope-gate-service")

    await expect(
      executeGatedConnectorAction({
        toolkit: "gmail",
        actionSlug: "GMAIL_SEND_EMAIL",
        requestedScopes: [GMAIL_SEND_SCOPE],
        composioConnectedAccountId: "ca_1",
        appUserId: "user_1",
        tx: FAKE_TX,
        audit: VALID_AUDIT,
      })
    ).rejects.toBeInstanceOf(ConnectorAuditWriteFailedError)
    // The real side effect against Composio already happened -- that's the
    // whole reason this failure must be loud rather than silently retried
    // away or swallowed.
    expect(executeActionMock).toHaveBeenCalledTimes(1)
    expect(logActivityMock).toHaveBeenCalledTimes(1)
  })
})
