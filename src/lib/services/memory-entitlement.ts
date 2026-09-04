// R68 (Institutional Memory Graph) Phase 8 -- THE ENTITLEMENT GATE ON EVERY
// MEMORY RECALL AND WRITE PATH.
//
// WHY THIS FILE EXISTS. IMG-031 (platform.img_spec, phase IMG-P8-PACKAGING)
// is requirement 4, restated by the owner directly: "institutional memory is
// a software feature, its a module embedded in veridian ai os erp and all its
// processes and products. it can be offered as a standalone product also."
// The second half of that sentence is what has no code behind it until now --
// every one of Phases 1-7 built memory as something every org simply HAS.
// This file is what makes it a thing an org can be entitled to, or not.
//
// Its own gate_fail, quoted from the spec row, is one sentence: "A
// non-entitled org can recall." Everything below exists to make that false.
//
// ─── THIS IS NOT A NEW MECHANISM ────────────────────────────────────────
//
// The entitlement substrate already exists and is already live: 27 rows in
// platform.product_branches, and per-org rows in
// compliance.org_product_branch_enablements, read by
// product-branch-service.ts's isBranchEnabledForOrg(). IMG gets a branch row
// there like every other vertical (drizzle/0547), and
// img-enablement-service.ts is the same thin per-vertical wrapper shape as
// erp-enablement-service.ts / construction-enablement-service.ts.
//
// What this file adds is ONE thing those wrappers cannot do: ask the same
// question from INSIDE a transaction that is already open.
//
// ─── WHY IT CANNOT JUST CALL isBranchEnabledForOrg() ────────────────────
//
// Because that is a live production incident, by name. isBranchEnabledForOrg()
// opens its own withTenantContext() transaction. The app_runtime pool is
// `max: 5` for the whole application (src/lib/db/tenant-scoped.ts). A function
// already holding one connection that calls it holds two -- and on 2026-09-02
// exactly this chain (getProjectDashboard -> earnedValueReport ->
// requireConstructionEnabled -> isBranchEnabledForOrg) left all five
// app_runtime sessions "idle in transaction" for 25 minutes. That is the
// example written into tenant-scoped.ts's own nesting-guard comment, and the
// guard added there now THROWS on it in development and test.
//
// Every function this gate protects (recallMemory, resolveMemoryScope,
// searchMemories, getMemoryRecordAsOf, authorizeMemoryWrite) already receives
// an open `tx`. So the check runs on that handle: one extra round-trip, zero
// extra connections, and the nesting guard stays silent. The SQL below is the
// same question isBranchEnabledForOrg() asks, against the same two tables,
// including its primary_product_branch_id rule -- not a second, driftable
// notion of "enabled".
//
// ─── WHY THE ORG COMES FROM THE TRANSACTION, NOT FROM THE CALLER ────────
//
// The org is read as compliance.current_org_id() -- the `app.current_org_id`
// GUC that withTenantContext() sets and that every real RLS policy on
// compliance.memory_records already checks. Three reasons, in order of
// importance:
//
//   1. It is the SAME org RLS will enforce for the rest of the transaction.
//      An entitlement check against an org the caller merely names could
//      pass for org A while the transaction goes on to read org B's rows.
//      Asking the transaction itself removes that gap by construction.
//   2. It cannot be spoofed by a caller, for the same reason
//      memory-write-authorization.ts re-derives the caller's role from live
//      rows instead of accepting it: an argument is a claim, a GUC set by
//      withTenantContext() is a fact.
//   3. It needs no signature change. searchMemories(tx, query, options) has
//      no orgId parameter at all, and adding an OPTIONAL one would have made
//      the gate fail OPEN for every existing caller that did not pass it --
//      which is precisely the failure IMG-031's gate_fail names.
//
// When the caller DOES have an org identity of its own (recallMemory and
// authorizeMemoryWrite both carry actor.orgId), it is passed in as
// `expectedOrgId` and cross-checked against the GUC. That is strictly
// additional: a mismatch is refused rather than resolved in either
// direction, on the same reasoning createMemoryRecord() already applies to
// its own actor/org disagreement (platform.error_log E-45, "A credential
// fallback is an identity change. Never make one silently").
//
// ─── FAIL-CLOSED, DELIBERATELY ──────────────────────────────────────────
//
// compliance.current_org_id() is `NULLIF(current_setting('app.current_org_id',
// true), '')` -- it returns NULL rather than raising when the GUC is unset. A
// NULL org therefore reaches the `entitled = false` branch and is REFUSED,
// which is the correct reading: a transaction that cannot say which org it is
// for has not proven entitlement for any org. There is no "unknown, so allow"
// path in this file, and there must never be one.
//
// ─── LEAF MODULE, ON PURPOSE ────────────────────────────────────────────
//
// Only `sql` from drizzle-orm and a type-only TenantDb import. Nothing else.
// memory-write-authorization.ts is deliberately importable by a unit test
// that stubs "@/lib/db" down to one fake client (see role-rank.ts's header
// for the same extraction, done for the same reason in Phase 6), and this
// gate runs inside it -- so pulling in compliance-service.ts's ServiceError
// (which transitively imports @/lib/email and veri-reward-service.ts) would
// break that. MemoryEntitlementError below carries `status = 403` so a route
// maps it exactly like a ServiceError; img-enablement-service.ts throws the
// real ServiceError for callers OUTSIDE a transaction.
import { sql } from "drizzle-orm"
import type { TenantDb } from "@/lib/db/tenant-scoped"

/**
 * IMG's row in platform.product_branches (drizzle/0547). Snake_case, matching
 * every other branch key in that table (`facilities_management`,
 * `veri_chat_v2`, `export_import`, ...).
 */
export const IMG_BRANCH_KEY = "institutional_memory"

/**
 * The refusal text. Deliberately the SAME sentence erp-enablement-service.ts
 * and construction-enablement-service.ts already use -- the owner's own
 * wording from the OPEN-07 decision of 2026-07-13 ("a polite, specific 403 --
 * never a generic 'Forbidden' -- naming the module the capability actually
 * lives in, so an admin knows what to purchase/enable"), with only the module
 * name changed. A refused org is told what to do about it, which is the point.
 */
export const IMG_NOT_ENTITLED_MESSAGE =
  "This capability is not part of the Module your organization purchased. " +
  "Please contact your organization's administrator. " +
  "This capability is already in the Institutional Memory module."

/**
 * Thrown by assertImgEntitled(). `status = 403` so an API route maps it the
 * same way it maps ServiceError; see this file's header for why it is not
 * literally a ServiceError.
 *
 * It is a REFUSAL, never a degraded answer: no caller in this codebase catches
 * it and continues with a partial recall. chat-service.ts's
 * fetchRelevantMemories() does catch it, and that is correct and intended --
 * it drops memory augmentation entirely and logs, rather than answering the
 * user from a half-filtered memory set.
 */
export class MemoryEntitlementError extends Error {
  readonly status = 403
  readonly branchKey = IMG_BRANCH_KEY
  /** The org the TRANSACTION was scoped to, or null when the GUC was unset. */
  readonly orgId: string | null
  /** Which of the two failure modes this was, for a log line that can be acted on. */
  readonly kind: "not_entitled" | "org_mismatch" | "no_org_in_transaction"

  constructor(kind: MemoryEntitlementError["kind"], orgId: string | null, detail: string) {
    super(`${IMG_NOT_ENTITLED_MESSAGE} (${detail})`)
    this.name = "MemoryEntitlementError"
    this.kind = kind
    this.orgId = orgId
  }
}

export type ImgEntitlementCheck = {
  entitled: boolean
  /** The org this transaction is scoped to, read from app.current_org_id. */
  transactionOrgId: string | null
  /** Null when entitled; otherwise why not, in enough detail to act on. */
  reason: string | null
}

/**
 * Positive results only, keyed on the open transaction handle.
 *
 * WHY MEMOIZE AT ALL. recallMemory() calls recallExact(), which calls
 * resolveMemoryScope() -- both of which are gated. Without this, one recall
 * costs two identical entitlement round-trips inside a pool whose whole
 * budget is five connections.
 *
 * WHY IT IS SAFE. The key is the transaction handle itself, so a cached
 * answer can only ever be reused by the very transaction that proved it, and
 * dies with it. Entitlement cannot change underneath an open transaction in a
 * way that transaction would be entitled to see: it reads one snapshot.
 *
 * WHY POSITIVES ONLY. A cached `false` would be a second place a refusal
 * could be got wrong, for no benefit -- a refusal throws, so nothing downstream
 * ever asks again. Caching only the "proven entitled" direction means the
 * worst a stale entry can do is save a query the transaction already paid for.
 */
const provenEntitledOrgsByTx = new WeakMap<object, Set<string>>()

type EntitlementRow = { tx_org_id: string | null; entitled: boolean }

/**
 * Asks -- on the caller's ALREADY-OPEN transaction -- whether the org this
 * transaction is scoped to holds a live IMG entitlement.
 *
 * The two arms of the EXISTS below are isBranchEnabledForOrg()'s own two arms,
 * in its own order:
 *   1. organisations.primary_product_branch_id = the IMG branch. An org whose
 *      entire brand identity IS this product is inherently entitled to it,
 *      with no separate add-on row -- the Wave 7 rule that stops a
 *      branch-branded org being charged twice for its own product.
 *   2. an org_product_branch_enablements row with is_enabled = true. Explicit
 *      row-per-org-branch-pair, never "row absence = enabled": absence is a
 *      refusal, and a disable-then-re-enable cycle keeps its audit trail.
 *
 * Never throws for a non-entitled org -- it RETURNS the refusal, so a caller
 * (and a test) can see which of the two failure modes occurred.
 * assertImgEntitled() is the throwing wrapper the real paths use.
 */
export async function checkImgEntitlement(
  tx: TenantDb,
  expectedOrgId?: string | null
): Promise<ImgEntitlementCheck> {
  const cached = provenEntitledOrgsByTx.get(tx as unknown as object)
  if (cached && expectedOrgId && cached.has(expectedOrgId)) {
    return { entitled: true, transactionOrgId: expectedOrgId, reason: null }
  }

  const rows = (await tx.execute(sql`
    SELECT
      compliance.current_org_id() AS tx_org_id,
      EXISTS (
        SELECT 1
        FROM platform.product_branches pb
        WHERE pb.branch_key = ${IMG_BRANCH_KEY}
          AND (
            EXISTS (
              SELECT 1 FROM compliance.organisations o
              WHERE o.id = compliance.current_org_id()
                AND o.primary_product_branch_id = pb.id
            )
            OR EXISTS (
              SELECT 1 FROM compliance.org_product_branch_enablements e
              WHERE e.org_id = compliance.current_org_id()
                AND e.product_branch_id = pb.id
                AND e.is_enabled = true
            )
          )
      ) AS entitled
  `)) as EntitlementRow[]

  const row = rows[0]
  const transactionOrgId = row?.tx_org_id ?? null

  if (!transactionOrgId) {
    return {
      entitled: false,
      transactionOrgId: null,
      reason:
        "this transaction is not scoped to an organisation (app.current_org_id is unset) -- every memory read and write must run inside withTenantContext()",
    }
  }

  // Checked BEFORE the entitlement verdict is honoured: an entitled org A must
  // not be able to carry a caller claiming org B past this gate.
  if (expectedOrgId && expectedOrgId !== transactionOrgId) {
    return {
      entitled: false,
      transactionOrgId,
      reason: `the caller identifies as org ${expectedOrgId} but this transaction is scoped to org ${transactionOrgId} -- refusing rather than picking one`,
    }
  }

  if (!row?.entitled) {
    return {
      entitled: false,
      transactionOrgId,
      reason: `org ${transactionOrgId} has no active '${IMG_BRANCH_KEY}' product-branch entitlement`,
    }
  }

  let set = provenEntitledOrgsByTx.get(tx as unknown as object)
  if (!set) {
    set = new Set<string>()
    provenEntitledOrgsByTx.set(tx as unknown as object, set)
  }
  set.add(transactionOrgId)

  return { entitled: true, transactionOrgId, reason: null }
}

/**
 * The gate every IMG recall and write path runs FIRST, before any of its own
 * logic. Throws MemoryEntitlementError (403) for a non-entitled org.
 *
 * Deliberately throws rather than returning a verdict the caller might forget
 * to read -- the same reason memory-write-authorization.ts pairs its
 * verdict-returning authorizeMemoryWrite() with a throwing
 * assertMemoryWriteAuthorized() and has the service functions call the
 * throwing one.
 */
export async function assertImgEntitled(tx: TenantDb, expectedOrgId?: string | null): Promise<void> {
  const check = await checkImgEntitlement(tx, expectedOrgId)
  if (check.entitled) return

  const kind: MemoryEntitlementError["kind"] = !check.transactionOrgId
    ? "no_org_in_transaction"
    : expectedOrgId && expectedOrgId !== check.transactionOrgId
      ? "org_mismatch"
      : "not_entitled"

  throw new MemoryEntitlementError(kind, check.transactionOrgId, check.reason ?? "not entitled")
}
