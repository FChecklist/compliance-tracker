// WO-DPDP-001 4.7 -- "the record": a hash-chained, human-readable,
// append-only event log per org. hash = sha256(prev_hash || canonical(row)),
// computed here (not by a DB trigger) so the exact bytes hashed are
// auditable from this one function rather than split across the app and a
// plpgsql trigger.
//
// EVENT KINDS: the work order says "39 event kinds enumerated in the
// artefact's 'Every event type' screen" -- the owner-supplied
// veridian-complete.html does NOT actually contain a screen enumerating 39
// named kinds (checked directly against the file before writing this), so
// that specific count is not something this file can verify or reproduce.
// What IS real and traceable to the artefact is the set of concrete actions
// its own event handlers perform (log(...) calls in its <script> block) --
// DPDP_EVENT_KINDS below is that set, plus the identity/session/org-model
// actions Phase 2 needed that the prototype's simulated data didn't need to
// name. Not claimed to be a verified 39; flagged rather than padded to a
// round number.
//
// db.execute is used directly (not withDpdpContext) for the INSERT because
// this function is the ONE place allowed to write dpdp.event, and it is
// always called from inside a caller's own withDpdpContext transaction (or,
// for identity_signed_in, pre-auth) -- see this repo's own nested-
// withTenantContext gotcha (tenant-scoped.ts's header comment) for why a
// second transaction here would be a bug, not a safety net.
import { createHash } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { db, dpdpEvent } from "@/lib/db"
import { withDpdpContext, type TenantDb } from "@/lib/db/tenant-scoped"

export const DPDP_EVENT_KINDS = [
  "identity_signed_in", "organisation_created", "membership_invited", "membership_named_in_role",
  "membership_joined", "membership_revoked", "can_sign_granted",
  "relationship_named", "relationship_agreement_sent", "relationship_agreement_signed", "relationship_ended",
  "data_location_asked", "data_location_confirmed",
  "obligation_assigned", "obligation_submitted", "obligation_sent_back", "obligation_stuck", "obligation_not_my_job", "obligation_accepted", "obligation_closed",
  "artefact_uploaded", "artefact_accepted", "artefact_flagged", "artefact_superseded", "artefact_redacted",
  "consent_campaign_sent", "consent_recorded", "consent_withdrawn",
  "rights_request_received", "rights_request_answered",
  "grievance_raised", "grievance_escalated", "grievance_determined",
  "breach_reported", "breach_board_notified", "breach_individuals_notified",
  "notice_published", "grievance_officer_appointed", "public_page_published",
  "attestation_signed", "audit_finding_written",
  "ai_proposal_applied", "ai_proposal_discarded",
] as const
export type DpdpEventKind = (typeof DPDP_EVENT_KINDS)[number]

export type LogDpdpEventInput = {
  orgId: string
  actorIdentityId?: string | null
  actorLabel: string
  kind: DpdpEventKind
  summary: string
  detail?: string
  route?: string
}

/** Stable key order so the same logical row always hashes the same way. Exported for the sibling test. */
export function canonicalizeDpdpEventPayload(row: Record<string, unknown>): string {
  return JSON.stringify(row, Object.keys(row).sort())
}

export type DpdpEventHashPayload = {
  orgId: string; actorLabel: string; kind: string; summary: string; detail: string | null; occurredAt: string; prevHash: string | null
}

/** The exact chain formula, pure and exported so it's tested once, not re-derived by both logDpdpEvent and verifyDpdpEventChain. */
export function computeDpdpEventHash(payload: DpdpEventHashPayload): string {
  return createHash("sha256").update((payload.prevHash ?? "") + canonicalizeDpdpEventPayload(payload)).digest("hex")
}

/**
 * Appends one event, chained to the org's own previous hash (chains are
 * per-org, not global -- verifying one client's history never requires
 * another client's data). Accepts an optional `tx` so callers already
 * inside a withDpdpContext transaction append to the SAME transaction
 * instead of opening a second one (this repo's nested-transaction gotcha).
 */
export async function logDpdpEvent(input: LogDpdpEventInput, tx?: TenantDb): Promise<void> {
  const runner = tx ?? db
  const prev = await runner.query.dpdpEvent.findFirst({
    where: eq(dpdpEvent.orgId, input.orgId),
    orderBy: [desc(dpdpEvent.occurredAt)],
  })
  const prevHash = prev?.hash ?? null
  const occurredAt = new Date()
  const hash = computeDpdpEventHash({
    orgId: input.orgId,
    actorLabel: input.actorLabel,
    kind: input.kind,
    summary: input.summary,
    detail: input.detail ?? null,
    occurredAt: occurredAt.toISOString(),
    prevHash,
  })

  await runner.insert(dpdpEvent).values({
    orgId: input.orgId,
    actorIdentityId: input.actorIdentityId ?? null,
    actorLabel: input.actorLabel,
    kind: input.kind,
    summary: input.summary,
    detail: input.detail,
    route: input.route,
    occurredAt,
    prevHash,
    hash,
  })
}

export type ChainVerification = { ok: boolean; brokenAtEventId: string | null; checked: number }

/**
 * Recomputes every hash in an org's chain from scratch and compares. D9:
 * "hash chain verifies across >= 50 events" -- this is the verification
 * script that check runs against, not a separate one-off.
 */
export async function verifyDpdpEventChain(orgId: string): Promise<ChainVerification> {
  // Must run under this org's own tenant context: dpdp.event's RLS is
  // `org_id = dpdp.current_org_id()` (plus the bootstrap-only preauth
  // INSERT policy, drizzle/0420) -- the plain, unscoped `db` client always
  // has current_org_id() = NULL, so this query would silently return zero
  // rows regardless of how many events actually exist. Found live via
  // scripts/tmp-dpdp-smoke-test.ts.
  const rows = await withDpdpContext({ orgId }, (tx) =>
    tx.query.dpdpEvent.findMany({
      where: eq(dpdpEvent.orgId, orgId),
      orderBy: (t, { asc }) => [asc(t.occurredAt)],
    })
  )
  let prevHash: string | null = null
  for (const row of rows) {
    const expected = computeDpdpEventHash({
      orgId: row.orgId,
      actorLabel: row.actorLabel,
      kind: row.kind,
      summary: row.summary,
      detail: row.detail ?? null,
      occurredAt: row.occurredAt.toISOString(),
      prevHash,
    })
    if (expected !== row.hash || (row.prevHash ?? null) !== prevHash) {
      return { ok: false, brokenAtEventId: row.id, checked: rows.length }
    }
    prevHash = row.hash
  }
  return { ok: true, brokenAtEventId: null, checked: rows.length }
}
