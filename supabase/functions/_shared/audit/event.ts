// DPDP audit trail -- building one audit row's content (owner spec 2026-10-06, items 1, 2 and 9). PURE apart from the Web Crypto it calls.
//
// `buildContent` turns what the caller knows into the canonical text that is stored (and hashed) in dpdp.audit_event.content_canonical. In that text:
//   * every personal value is SEALED ({ "s": "aes1:...", "k": "email" | "ip" | "mobile" | "device" | "id" | "text" }); the kind rides along unsealed so a later
//     masked download knows HOW to mask it without opening anything it does not need to;
//   * a changed field is { field, kind, before, after } with both sides sealed when the field is personal, plain when it is not (a status, a count);
//   * everything the caller passed in `details` goes through scrub() first, so a password, code, card, key or token cannot enter the log by accident;
//   * proof levels sit beside each group (observed / declared / inferred), and `mismatch` is set when a claim and an observation disagree.
// The server's own clock is NOT in here: the database stamps `server_time_us` (the authority) and binds it into row_hash. What IS here is the machine-reported
// time, its time zone, and the skew between that and the moment this function ran.
import { type KeyRing, seal } from "./seal.ts"
import { scrub } from "./scrub.ts"
import { canonicalJson } from "./chain.ts"
import { type AiDeclaration, type AiProvenance, assessProvenance, parseUa, type VendorRanges } from "./provenance.ts"
import type { MaskKind } from "./mask.ts"

export const EVENT_TYPES = [
  "login", "failed_login", "create", "edit", "delete", "publish", "download_export", "read_personal_data", "consent", "erasure", "denied",
  "ai_read", "ai_prepare", "human_confirm", "staff_read", "legal_hold", "retention",
] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const isEventType = (v: unknown): v is EventType => typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v)

export type ActorType = "human" | "ai_link" | "system"

export type FieldChange = {
  field: string
  /** What kind of value it is: decides masking in a download. Omit for a non-personal value (it is stored plain). */
  kind?: MaskKind
  before?: unknown
  after?: unknown
}

export type AuditInput = {
  orgId: string
  eventType: EventType
  actorType: ActorType
  actorUserId?: string | null
  actorRole?: string | null
  actorEmail?: string | null
  target?: { table: string; id: string } | null
  changes?: FieldChange[]
  /** Anything else worth keeping; scrubbed of secrets before it is stored. */
  details?: Record<string, unknown> | null
  /** Ties an AI read -> a proposal -> the human's confirm -> the write together. */
  requestId?: string | null
  sessionId?: string | null
  loginMethod?: string | null
  outcome?: "ok" | "denied" | "failed" | null
  net?: { ip?: string | null; country?: string | null; asn?: string | null; userAgent?: string | null; deviceId?: string | null }
  client?: { time?: string | null; timeZone?: string | null }
  ai?: { declared: AiDeclaration; vendorRanges: VendorRanges } | null
  link?: { id: string; tokenFp?: string | null } | null
  /** sha256 of the guide / prompt text given to the AI on this call. */
  guideHash?: string | null
  confirm?: { linkId?: string | null; clickedByUserId?: string | null; clickedAt?: string | null } | null
  aiCallId?: string | null
  /** For an export event: the verification hash of the file handed out. */
  refHash?: string | null
}

export type Sealed = { s: string; k: MaskKind }
export type BuiltContent = { canonical: string; content: Record<string, unknown> }

const clip = (v: string | null | undefined, n: number): string | null => (v == null || v === "" ? null : String(v).slice(0, n))

/** Skew between the machine-reported time and `nowMs`, in milliseconds (machine minus server), or null when the machine gave no usable time. */
export function clockSkewMs(machineTime: string | null | undefined, nowMs: number): number | null {
  if (!machineTime) return null
  const t = Date.parse(machineTime)
  return Number.isFinite(t) ? t - nowMs : null
}

export async function buildContent(ring: KeyRing, input: AuditInput, nowMs: number = Date.now()): Promise<BuiltContent> {
  const org = input.orgId
  const sealed = async (field: string, kind: MaskKind, value: string | null | undefined): Promise<Sealed | null> =>
    value == null || value === "" ? null : { s: await seal(ring, String(value), org, field), k: kind }

  const ua = parseUa(input.net?.userAgent)
  const prov: AiProvenance | null = input.ai ? assessProvenance({ userAgent: input.net?.userAgent ?? null, ip: input.net?.ip ?? null, declared: input.ai.declared, ranges: input.ai.vendorRanges }) : null

  const changes: Array<Record<string, unknown>> = []
  for (const [i, c] of (input.changes ?? []).slice(0, 60).entries()) {
    const fieldName = String(c.field).slice(0, 80)
    const stringify = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(scrub(v)))
    if (c.kind) {
      changes.push({ field: fieldName, kind: c.kind, personal: true, before: await sealed(`change.${i}.before`, c.kind, stringify(c.before)), after: await sealed(`change.${i}.after`, c.kind, stringify(c.after)) })
    } else {
      changes.push({ field: fieldName, personal: false, before: scrub(c.before), after: scrub(c.after) })
    }
  }

  const skew = clockSkewMs(input.client?.time, nowMs)
  const content: Record<string, unknown> = {
    v: 1,
    org_id: org,
    event_type: input.eventType,
    outcome: input.outcome ?? "ok",
    actor: {
      user_id: input.actorUserId ?? null,
      role: clip(input.actorRole, 40),
      type: input.actorType,
      email: await sealed("actor.email", "email", input.actorEmail),
    },
    target: input.target ? { table: clip(input.target.table, 80), id: clip(input.target.id, 120) } : null,
    changes,
    details: input.details ? scrub(input.details) : null,
    request_id: clip(input.requestId, 120),
    session_id: clip(input.sessionId, 120),
    login_method: clip(input.loginMethod, 40),
    time: {
      machine_time: clip(input.client?.time, 40),
      machine_time_zone: clip(input.client?.timeZone, 64),
      skew_ms: skew,
      proof: input.client?.time ? "declared" : "not_checked",
    },
    net: {
      ip: await sealed("net.ip", "ip", input.net?.ip),
      country: clip(input.net?.country, 2),
      asn: clip(input.net?.asn, 20),
      user_agent: await sealed("net.user_agent", "text", clip(input.net?.userAgent, 400)),
      browser: ua.browser,
      os: ua.os,
      device_id: await sealed("net.device_id", "device", input.net?.deviceId),
      proof: input.net?.ip || input.net?.userAgent ? "observed" : "not_checked",
    },
    ai: prov
      ? {
          fetcher: prov.fetcher,
          vendor_observed_ua: prov.vendorObservedUa,
          vendor_observed_network: prov.vendorObservedNetwork,
          vendor_from_declared_model: prov.vendorDeclared,
          model: clip(prov.declared.model, 120),
          version: clip(prov.declared.version, 120),
          session_id: await sealed("ai.session_id", "id", prov.declared.sessionId),
          machine_id: await sealed("ai.machine_id", "device", prov.declared.machineId),
          proof: prov.proof,
          mismatch: prov.mismatch,
          mismatch_reasons: prov.mismatchReasons,
        }
      : null,
    link: input.link ? { id: input.link.id, token_fp: clip(input.link.tokenFp, 16) } : null,
    guide_hash: clip(input.guideHash, 64),
    confirm: input.confirm ? { link_id: input.confirm.linkId ?? null, clicked_by_user_id: input.confirm.clickedByUserId ?? null, clicked_at: input.confirm.clickedAt ?? null } : null,
    ai_call_id: clip(input.aiCallId, 120),
    ref_hash: clip(input.refHash, 64),
  }
  return { canonical: canonicalJson(content), content }
}

/** The jsonb handed to public.dpdp_audit_append: the canonical text plus the searchable columns (the SQL re-derives them from the text and refuses a mismatch). */
export function appendPayload(built: BuiltContent): { content_canonical: string } {
  return { content_canonical: built.canonical }
}
