// CRR-158 real-execution wrapper. The PURE gate decision
// (evaluateConnectorGate -- scope-vs-allow-list, delete-scope, missing-
// audit-descriptor) lives in composio-connectors.ts next to the scope
// allow-list data and the Composio API client it decides whether to call;
// this file is the one real call path a write/edit action against a
// connected Google account is allowed to run through, composing that pure
// gate with the two effects a write/edit action actually requires:
// executeAction() against Composio, then a real audit_logs row via
// logActivity(). Deliberately its own file, not folded into
// composio-connectors.ts -- that file stays import-free of @/lib/audit and
// @/lib/db/tenant-scoped (its existing test suite mocks nothing but global
// fetch), matching the "pure logic file / DB-touching service file" split
// connector-data-service.ts / connector-data-store.ts already established
// for this same toolkit, and this repo's established "never a live DB from
// a .test.ts file" discipline (approval-workflow-service.test.ts /
// prompt-governance-gates.test.ts's own notes on this).
//
// NOT live Google OAuth enablement. CRR-007 (verify COMPOSIO_API_KEY) is
// BLOCKED -- provisioning it means paying for a Composio plan, and that
// purchase is a standing DECLINED item. Nothing here has run against a real
// Google account or a live Composio call this session. What IS real: the
// gate itself (evaluateConnectorGate, tested directly against fixtures in
// composio-connectors.test.ts) and this wrapper's own control flow (tested
// in this file's sibling .test.ts with executeAction/logActivity both
// mocked at the module boundary) -- so the day COMPOSIO_API_KEY exists, the
// gate is already enforcing; only a real sandbox smoke test is left to run,
// not new code to write.
import {
  executeAction,
  evaluateConnectorGate,
  type ConnectorToolkit,
  type ConnectorAuditDescriptor,
  type ConnectorActionCategory,
  type ScopeViolation,
  type ExecuteActionResult,
} from "@/lib/composio-connectors"
import { logActivity } from "@/lib/audit"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { users } from "@/lib/db"

// Mirrors logActivity()'s own LogActivityParams discriminated union
// (audit.ts) -- exactly one of dbUser/apiKey, never neither/both, so every
// audit row this gate ever writes still gets a real actor.
export type ConnectorAuditActor =
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }

export type GatedConnectorAudit = ConnectorAuditDescriptor & ConnectorAuditActor

export type GatedConnectorActionParams = {
  toolkit: ConnectorToolkit
  actionSlug: string
  /** The connected account's actually-granted scopes for this toolkit -- e.g. from getAuthConfigScopes() or connector_accounts. */
  requestedScopes: string[]
  composioConnectedAccountId: string
  appUserId: string
  args?: Record<string, unknown>
  /** Required for any write/edit action -- evaluateConnectorGate() refuses the call before Composio is ever invoked if this is missing. */
  audit?: GatedConnectorAudit
  /** Same-transaction requirement as logActivity() itself: pass the tx the caller's own write is running inside, when there is one. */
  tx: TenantDb
}

export type GatedConnectorActionResult = {
  category: ConnectorActionCategory
  result: ExecuteActionResult
  auditRecorded: boolean
}

/** Thrown before Composio is ever called -- the pure gate refused this call. */
export class ConnectorGateDeniedError extends Error {
  readonly violations: ScopeViolation[]
  constructor(violations: ScopeViolation[]) {
    super(`Connector action denied by CRR-158 scope gate: ${violations.map((v) => v.detail).join("; ")}`)
    this.name = "ConnectorGateDeniedError"
    this.violations = violations
  }
}

/**
 * Thrown when the Composio call itself succeeded (a real, non-undoable side
 * effect already happened against the user's Google account) but the
 * required audit_logs row failed to write. Deliberately loud, never
 * swallowed: a write/edit action with no audit row is CRR-158's own third
 * gate_fail condition, and staying silent about it here would defeat the
 * point of writing the gate at all.
 */
export class ConnectorAuditWriteFailedError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super(
      `Connector write/edit action against Composio succeeded but its required audit row failed to write -- CRR-158 gate_fail ("any write/edit action that produces no audit row"). Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.name = "ConnectorAuditWriteFailedError"
    this.cause = cause
  }
}

/**
 * The one real call path a connector action is allowed to run through once
 * CRR-007 unblocks live Composio calls. Read actions need no audit
 * descriptor and run straight through if scopes pass. Write/edit actions
 * require `audit`; on a successful Composio call this then writes exactly
 * one audit_logs row (action `connector.write` / `connector.edit`, naming
 * the actor, the target entityId, and a server-generated timestamp) before
 * returning. Delete-category actions and any scope violation are refused
 * before Composio is ever called.
 */
export async function executeGatedConnectorAction(params: GatedConnectorActionParams): Promise<GatedConnectorActionResult> {
  const verdict = evaluateConnectorGate({
    toolkit: params.toolkit,
    actionSlug: params.actionSlug,
    requestedScopes: params.requestedScopes,
    audit: params.audit,
  })
  if (!verdict.allowed) {
    throw new ConnectorGateDeniedError(verdict.violations)
  }

  const result = await executeAction(params.actionSlug, params.composioConnectedAccountId, params.appUserId, params.args ?? {})

  let auditRecorded = false
  if ((verdict.category === "write" || verdict.category === "edit") && result.successful) {
    // params.audit is guaranteed present here -- evaluateConnectorGate()
    // would already have refused above otherwise.
    const audit = params.audit!
    const base = {
      tx: params.tx,
      orgId: audit.orgId,
      action: `connector.${verdict.category}`,
      entityType: audit.entityType,
      entityId: audit.entityId,
      details: audit.details ?? `${params.toolkit}:${params.actionSlug}`,
    }
    try {
      if (audit.dbUser) {
        await logActivity({ ...base, dbUser: audit.dbUser })
      } else {
        await logActivity({ ...base, apiKey: audit.apiKey! })
      }
      auditRecorded = true
    } catch (cause) {
      throw new ConnectorAuditWriteFailedError(cause)
    }
  }

  return { category: verdict.category, result, auditRecorded }
}
