// R68 (Institutional Memory Graph) Phase 6 -- THE WRITE PATH'S SERVER-SIDE
// AUTHORIZATION GATE.
//
// WHY THIS FILE EXISTS. R-IMG-07 (platform.crr_ruling, ruled 2026-09-03,
// is_binding = true) is the ruling this file implements, and it says two
// things that had no code behind them until now:
//
//   "authorisation goes through the existing three booleans (chain row
//    exists, inputs resolve, caller holds min_role), SERVER-SIDE.
//    Classification may happen in the browser but never authorises."
//
// Verified live before writing this file (Supabase MCP, project
// pcrjmlpuqsbocqfwoxod): platform.error_log id E-45 -- the shared-key tenant
// fallback the original work order treated as a gate on this whole phase --
// has status = CLOSED, fixed 2026-08-22 in commit d5bf258 / PR #91. The gate
// the work order assumed is genuinely lifted, which is why this phase builds
// the write path's authorization rather than merely designing it.
//
// WHAT "THREE BOOLEANS" MEANS HERE, CONCRETELY. Each of the three is a real,
// separately-reported boolean derived from a real database read, not a
// composite pass/fail:
//
//   1. callerContextResolves -- the caller is a real, live principal in the
//      target org: an active compliance.users row, or (the server-to-server
//      path this codebase already supports, see actor-context.ts) an active
//      compliance.api_keys row for that same org. When the write declares a
//      chain, that chain must ALSO be a real platform.dynamic_chains row for
//      the same org -- that is this codebase's own actual "chain" entity
//      (conversations.dynamicChainId / tasks.dynamicChainId, schema.ts), so
//      "chain row exists" is checked against the real table rather than
//      against an invented one.
//   2. inputsResolve -- what the write points AT is real: the target org
//      matches the caller's own org (re-derived from the users/api_keys row,
//      never taken from the request), a DEPARTMENT-scoped write names a real
//      compliance.departments row in that org, a USER-scoped write names a
//      real user in that org, and a supersede/promote/archive names a memory
//      row that actually exists and belongs to that org.
//   3. roleSufficient -- the caller's REAL role (read from the users row on
//      this connection, never supplied by the caller) ranks at or above the
//      minimum this particular write requires. API-key callers have no role,
//      only scopes -- exactly as auth-guard.ts's own requireRoleOrScope()
//      already models -- so they are gated on the "write" scope instead.
//
// REUSE, NOT A SECOND AUTHORIZATION MODEL. ROLE_RANK and UserRole are
// imported from src/lib/supabase/auth-guard.ts -- the same real rank table
// requireRole()/hasRole() use, and the same import shape ~20 other services
// already use (approval-workflow-service.ts, crm-service.ts,
// erp-payment-entries-service.ts, ...). There is deliberately no second rank
// table, no second role enum, and no memory-specific notion of "admin" here.
//
// WHY IT CANNOT BE DONE CLIENT-SIDE, AND WHAT STOPS A CALLER FAKING IT. The
// actor object this module accepts carries IDENTITY ONLY (orgId, the caller
// id, an optional real users.id for the D-05 identity bridge, an optional
// chain id). It carries no role, no permission list, and no "authorized"
// flag -- every one of the three booleans is re-derived here from live rows
// on the caller's own tenant-scoped connection. assertNoClientAuthorityClaim()
// below turns that from a convention into an enforced one: an actor object
// that arrives carrying `role`, `authorized`, `isAuthorized`, `permissions`
// or `bypassAuthorization` is REJECTED outright rather than having those
// fields quietly ignored, because a caller that sends one is either
// misunderstanding this boundary or attacking it, and silently ignoring the
// field would leave both cases invisible.
//
// RELATIONSHIP TO RLS. This gate NARROWS; it never widens. Every read and
// write it authorizes still runs inside the caller's own withTenantContext()
// transaction, under R65 Part C Phase 1's real RLS policies and R68 Phase 1's
// append-only trigger (drizzle/0541). If this gate had a bug, RLS would still
// refuse a cross-tenant write at the database level -- the same layering
// resolveMemoryScope() already documents (CRR-234: authorization lives in
// RLS, not only here).
import { sql } from "drizzle-orm"
import type { TenantDb } from "@/lib/db/tenant-scoped"
// Imported from the leaf module rather than from auth-guard.ts itself.
// auth-guard.ts re-exports these two names unchanged (and that is still the
// import every existing service uses), but it also pulls in next/server,
// next/headers and eight service modules -- weight this gate has no use for,
// and which a unit test that stubs "@/lib/db" cannot load at all. Same table,
// one definition, no duplicate rank map. See role-rank.ts's own header.
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
// R68 Phase 8 (IMG-031). Also a leaf -- see memory-entitlement.ts's own header
// for why it imports nothing but drizzle's `sql`: this module has to stay
// loadable by a unit test that stubs "@/lib/db" down to one fake client, and
// the entitlement gate now runs inside it.
import { assertImgEntitled } from "./memory-entitlement"

// ─── Actor ──────────────────────────────────────────────────────────────

/**
 * Identity of whoever is performing a memory write. IDENTITY ONLY -- see
 * this file's header: nothing here asserts what the caller may do, and
 * anything that looks like such an assertion is rejected by
 * assertNoClientAuthorityClaim() rather than trusted.
 */
export type MemoryWriteActor = {
  /** The organisation the write is being made in. Must match the caller's own. */
  orgId: string
  /**
   * The caller id as the calling layer knows it. Per D-05 (the identity
   * bridge, see run-submission.ts's RunSubmissionInput.actorUserId) this MAY
   * be a compliance.api_keys.id rather than a real user id -- which is
   * exactly why this module resolves it against both tables instead of
   * assuming.
   */
  userId: string
  /**
   * The real compliance.users.id when one is known (D-05's own field name
   * and meaning, carried through unchanged). When present it takes
   * precedence over `userId` for user resolution.
   */
  actorUserId?: string | null
  /**
   * Optional platform.dynamic_chains id this write is being performed under.
   * When supplied it must resolve to a real chain row in the same org --
   * R-IMG-07's "chain row exists". When absent, that half of boolean 1 is
   * reported as satisfied-by-absence (`chainChecked: false`) rather than
   * silently passed, so a reader of the decision can tell the difference.
   */
  chainId?: string | null
}

/** Field names that would make an actor object a client-supplied authority
 * claim rather than an identity. Rejected on sight -- see the header. */
const FORBIDDEN_ACTOR_KEYS = ["role", "roles", "authorized", "isAuthorized", "permissions", "bypassAuthorization", "allow"] as const

export class MemoryWriteAuthorizationError extends Error {
  readonly decision: MemoryWriteDecision
  constructor(decision: MemoryWriteDecision) {
    super(`memory write refused: ${decision.reason ?? "unauthorized"}`)
    this.name = "MemoryWriteAuthorizationError"
    this.decision = decision
  }
}

/**
 * Rejects an actor object that carries its own authorization verdict. This
 * is the enforceable form of "the authorization decision must be server-side
 * only and must never trust a client-supplied 'I am authorized' flag":
 * ignoring such a field silently would leave a caller believing it was
 * honoured, and would leave an attempt to smuggle one invisible.
 */
export function assertNoClientAuthorityClaim(actor: MemoryWriteActor): void {
  const present = FORBIDDEN_ACTOR_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(actor, k))
  if (present.length > 0) {
    throw new Error(
      `memory write actor carries a client-supplied authorization claim (${present.join(", ")}) -- authorization for memory writes is derived server-side from live compliance.users/compliance.api_keys rows only, never from the caller. Remove ${present.length === 1 ? "this field" : "these fields"} and pass identity only.`
    )
  }
}

// ─── Target ─────────────────────────────────────────────────────────────

export type MemoryWriteOperation = "create" | "supersede" | "promote" | "archive"

/**
 * What the write points at. For create this comes from the caller's own
 * input; for supersede/promote/archive it is derived from the memory row the
 * service function has ALREADY fetched under RLS (`existingRecord`), so this
 * module never re-reads a row the caller just read -- one fetch, one
 * authorization, no window between them.
 */
export type MemoryWriteTarget = {
  operation: MemoryWriteOperation
  scopeType: string
  scopeId?: string | null
  /** memory_records.user_id the write is aimed at (USER-scoped writes). */
  targetUserId?: string | null
  /** Required for supersede/promote/archive: the row already fetched under RLS. */
  existingRecord?: { id: string; orgId: string | null; scopeType: string; userId: string | null } | null
}

export type MemoryWriteDecision = {
  allowed: boolean
  /** Boolean 1: a real live principal (+ a real chain row when one was declared). */
  callerContextResolves: boolean
  /** Boolean 2: the org/department/user/memory row the write names all really exist. */
  inputsResolve: boolean
  /** Boolean 3: the caller's real role (or api-key scope) meets this write's minimum. */
  roleSufficient: boolean
  /** True only when the actor actually declared a chainId, so a reader can tell
   * "chain verified" from "no chain was claimed". */
  chainChecked: boolean
  /** The role read from the live users row -- null for an api-key caller. */
  resolvedRole: UserRole | null
  requiredRole: UserRole
  reason: string | null
}

// ─── Minimum role per write ─────────────────────────────────────────────

/**
 * The minimum role each memory write requires, by blast radius.
 *
 * DELIBERATE, DISCLOSED CALIBRATION -- this is the part of the gate most
 * worth arguing with, so the reasoning is written down rather than left
 * implicit:
 *
 *  - `member` (rank 2) is the FLOOR for every memory write. That is not a
 *    no-op: it really does reject `viewer`, `client_viewer`,
 *    `external_auditor` and `stage_0` (all rank 1) from causing ANY write to
 *    institutional memory. An external auditor's questions must not become
 *    the organisation's remembered facts, and before this gate nothing
 *    stopped that.
 *  - DEPARTMENT-scoped writes require `manager` (rank 3). A department
 *    memory speaks for a whole department; R68 Phase 3 shipped that scope
 *    with no callers at all, so this bar costs no existing behaviour.
 *  - Writing to ANOTHER user's USER-scoped memory requires `admin` (rank 5).
 *    This is the case CRR-235 and searchMemories()'s own requestingUserId
 *    filter exist to protect on the READ side; the write side had no
 *    equivalent until now.
 *  - Changing memory that already exists (supersede/promote/archive) at
 *    ORGANIZATION or DEPARTMENT scope requires `manager`. Adding a candidate
 *    fact is a proposal; rewriting, confirming or retiring durable org
 *    memory is an act of authority -- directive §14's own distinction
 *    ("AI-inferred info must NOT auto-become authoritative fact"). All three
 *    of those functions currently have zero non-test callers (verified by
 *    grep over src/ on this branch), so this bar likewise costs no existing
 *    behaviour.
 *  - ORGANIZATION-scoped CREATE is deliberately left at `member`, and this
 *    is the one place the bar is lower than blast radius alone would
 *    suggest. Raising it would break a real, already-shipped path:
 *    run-submission.ts's captureTaskResultMemory() writes an
 *    ORGANIZATION-scoped TASK_RESULT row whenever an ordinary member
 *    finishes a task without a project. Silently breaking that to make this
 *    table look stricter would be worse than stating the tradeoff. The row
 *    it writes is still gated by the `member` floor, by RLS, and (for AI
 *    origination) by the attribution rule in memory-service.ts.
 */
export function requiredRoleForMemoryWrite(actor: MemoryWriteActor, target: MemoryWriteTarget): UserRole {
  const scopeType = target.existingRecord?.scopeType ?? target.scopeType
  const targetUserId = target.existingRecord?.userId ?? target.targetUserId ?? null
  const actorUserId = actor.actorUserId ?? actor.userId

  if (scopeType === "USER" && targetUserId && targetUserId !== actorUserId) return "admin"
  if (scopeType === "DEPARTMENT") return "manager"
  if (target.operation !== "create" && (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT")) return "manager"
  return "member"
}

// ─── Row shapes read back from the live database ────────────────────────

type CallerUserRow = { id: string; role: string; is_active: boolean; org_id: string | null }
type CallerApiKeyRow = { id: string; scopes: string; is_active: boolean; org_id: string }

/**
 * Resolves the caller to a live principal. Tries the real-user path first
 * (`actorUserId` when present, else `userId` -- which under D-05 may itself
 * be an api_keys.id), then the api-key path. Both queries run on the
 * caller's own tenant-scoped connection, so RLS applies to them exactly as
 * it does to everything else this phase writes.
 */
async function resolveCaller(
  tx: TenantDb,
  actor: MemoryWriteActor
): Promise<{ user: CallerUserRow | null; apiKey: CallerApiKeyRow | null }> {
  const candidateUserId = actor.actorUserId ?? actor.userId
  const userRows = (await tx.execute(sql`
    SELECT id, role, is_active, org_id
    FROM compliance.users
    WHERE id = ${candidateUserId} AND org_id = ${actor.orgId}
    LIMIT 1
  `)) as CallerUserRow[]
  const user = userRows[0] ?? null
  if (user) return { user, apiKey: null }

  const keyRows = (await tx.execute(sql`
    SELECT id, scopes, is_active, org_id
    FROM compliance.api_keys
    WHERE id = ${actor.userId} AND org_id = ${actor.orgId}
    LIMIT 1
  `)) as CallerApiKeyRow[]
  return { user: null, apiKey: keyRows[0] ?? null }
}

/** R-IMG-07's "chain row exists", checked against this codebase's real chain
 * table (platform.dynamic_chains) and scoped to the same org. */
async function chainRowExists(tx: TenantDb, orgId: string, chainId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT id FROM platform.dynamic_chains WHERE id = ${chainId} AND org_id = ${orgId} LIMIT 1
  `)) as { id: string }[]
  return rows.length > 0
}

/**
 * Boolean 2 for a `create`: the scope's referent must be a real row in this
 * org. Costs at most ONE extra query, and none at all for the common
 * ORGANIZATION/PROJECT/TASK/CONVERSATION/DOCUMENT case (whose referents are
 * either the org itself -- already resolved by the caller's own users/
 * api_keys row carrying that org_id -- or free-form polymorphic pointers
 * this table has never constrained).
 */
async function createInputsResolve(tx: TenantDb, actor: MemoryWriteActor, target: MemoryWriteTarget): Promise<{ ok: boolean; reason: string | null }> {
  if (target.scopeType === "DEPARTMENT") {
    if (!target.scopeId) return { ok: false, reason: "DEPARTMENT-scoped write has no scopeId to resolve" }
    const rows = (await tx.execute(sql`
      SELECT id FROM compliance.departments WHERE id = ${target.scopeId} AND org_id = ${actor.orgId} LIMIT 1
    `)) as { id: string }[]
    if (rows.length === 0) return { ok: false, reason: `department ${target.scopeId} does not exist in org ${actor.orgId}` }
    return { ok: true, reason: null }
  }

  if (target.scopeType === "USER" && target.targetUserId) {
    const rows = (await tx.execute(sql`
      SELECT id FROM compliance.users WHERE id = ${target.targetUserId} AND org_id = ${actor.orgId} LIMIT 1
    `)) as { id: string }[]
    if (rows.length === 0) return { ok: false, reason: `user ${target.targetUserId} does not exist in org ${actor.orgId}` }
    return { ok: true, reason: null }
  }

  return { ok: true, reason: null }
}

/**
 * Boolean 2 for supersede/promote/archive: the memory row must already have
 * been fetched (under RLS) by the calling service function, and must belong
 * to this org. No re-read -- re-reading would open a window between the
 * row the caller validated and the row this gate authorized.
 */
function mutationInputsResolve(actor: MemoryWriteActor, target: MemoryWriteTarget): { ok: boolean; reason: string | null } {
  const record = target.existingRecord
  if (!record) return { ok: false, reason: `${target.operation} was authorized without the target memory row -- the calling function must fetch it under RLS first` }
  if (record.orgId !== actor.orgId) {
    return { ok: false, reason: `memory row ${record.id} belongs to org ${record.orgId ?? "NULL (GLOBAL/INDUSTRY)"}, not ${actor.orgId}` }
  }
  return { ok: true, reason: null }
}

// ─── The gate ───────────────────────────────────────────────────────────

/**
 * Computes all three booleans from live rows and returns them individually.
 * Never throws for an authorization failure -- it RETURNS the failure, so a
 * caller (and a test) can inspect exactly which of the three failed.
 * assertMemoryWriteAuthorized() below is the throwing wrapper the service
 * functions actually use.
 *
 * `tx` must already be inside withTenantContext({ orgId: actor.orgId, ... }).
 */
export async function authorizeMemoryWrite(
  tx: TenantDb,
  actor: MemoryWriteActor,
  target: MemoryWriteTarget
): Promise<MemoryWriteDecision> {
  assertNoClientAuthorityClaim(actor)

  // R68 Phase 8 (IMG-031) -- THE ENTITLEMENT GATE, BEFORE ANY OF THE THREE
  // BOOLEANS.
  //
  // Order matters, and this is deliberately first. The three booleans below
  // answer "may THIS CALLER perform THIS WRITE in this org" -- a question that
  // only makes sense once the org has the product at all. Running them first
  // would leak the answer to a question a non-entitled org is not entitled to
  // ask: a caller could learn, from the shape of the refusal, whether a given
  // user exists, whether a department id is real, or what role a user holds.
  //
  // It also THROWS rather than returning `allowed: false`. Entitlement is not
  // a fourth boolean: the three are a per-write authorization verdict, and a
  // caller (or a future reader of this file) must not be able to read a
  // "product not purchased" refusal as "this particular write was
  // unauthorized" and go looking for a role to fix it. Same reason
  // assertNoClientAuthorityClaim() above throws instead of returning.
  await assertImgEntitled(tx, actor.orgId)

  const requiredRole = requiredRoleForMemoryWrite(actor, target)
  const fail = (patch: Partial<MemoryWriteDecision> & { reason: string }): MemoryWriteDecision => ({
    allowed: false,
    callerContextResolves: false,
    inputsResolve: false,
    roleSufficient: false,
    chainChecked: Boolean(actor.chainId),
    resolvedRole: null,
    requiredRole,
    ...patch,
  })

  if (!actor.orgId) return fail({ reason: "actor.orgId is required" })
  if (!actor.userId && !actor.actorUserId) return fail({ reason: "actor must carry a caller id" })

  // ── Boolean 1: caller context ──
  const { user, apiKey } = await resolveCaller(tx, actor)
  if (!user && !apiKey) {
    return fail({ reason: `caller ${actor.actorUserId ?? actor.userId} does not resolve to a live user or api key in org ${actor.orgId}` })
  }
  if (user && !user.is_active) return fail({ reason: `caller ${user.id} is deactivated` })
  if (apiKey && !apiKey.is_active) return fail({ reason: `api key ${apiKey.id} is revoked` })

  if (actor.chainId) {
    const chainOk = await chainRowExists(tx, actor.orgId, actor.chainId)
    if (!chainOk) {
      return fail({ reason: `chain ${actor.chainId} does not exist in org ${actor.orgId}` })
    }
  }
  const callerContextResolves = true

  // ── Boolean 2: inputs resolve ──
  const inputs =
    target.operation === "create" ? await createInputsResolve(tx, actor, target) : mutationInputsResolve(actor, target)
  if (!inputs.ok) {
    return fail({ callerContextResolves, reason: inputs.reason ?? "inputs do not resolve" })
  }
  const inputsResolve = true

  // ── Boolean 3: role / scope ──
  const resolvedRole = (user?.role as UserRole | undefined) ?? null
  if (user) {
    const rank = ROLE_RANK[user.role as UserRole] ?? 0
    if (rank < ROLE_RANK[requiredRole]) {
      return fail({
        callerContextResolves,
        inputsResolve,
        resolvedRole,
        reason: `this ${target.operation} on a ${target.existingRecord?.scopeType ?? target.scopeType}-scoped memory requires ${requiredRole} or higher; ${user.id} is ${user.role}`,
      })
    }
  } else if (apiKey) {
    // Same axis auth-guard.ts's requireRoleOrScope() already uses: an api-key
    // caller has no role, so it is gated on the write scope instead.
    const scopes = apiKey.scopes.split(",").map((s) => s.trim())
    if (!scopes.includes("write")) {
      return fail({
        callerContextResolves,
        inputsResolve,
        reason: `api key ${apiKey.id} is not write-scoped`,
      })
    }
  }

  return {
    allowed: true,
    callerContextResolves,
    inputsResolve,
    roleSufficient: true,
    chainChecked: Boolean(actor.chainId),
    resolvedRole,
    requiredRole,
    reason: null,
  }
}

/** Throwing wrapper -- what memory-service.ts's write functions call before
 * their first write statement. */
export async function assertMemoryWriteAuthorized(
  tx: TenantDb,
  actor: MemoryWriteActor,
  target: MemoryWriteTarget
): Promise<MemoryWriteDecision> {
  const decision = await authorizeMemoryWrite(tx, actor, target)
  if (!decision.allowed) throw new MemoryWriteAuthorizationError(decision)
  return decision
}
