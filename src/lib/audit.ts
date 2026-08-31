import { auditLogs, type users } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { hashSessionToken } from "@/lib/services/session-limit-service"

// Single call site every route uses to write an audit/activity log row --
// replaces each route hand-building `auditLogs.values({...})` inline, so the
// "every log of usage/change has real time/date/user-ID/device" guarantee
// lives in one place instead of being re-implemented (and potentially
// missed) at 13+ call sites. `action` is free text by design -- see the
// schema.ts comment on `auditLogs` for why the old fixed enum was dropped.
//
// Must run inside the same withTenantContext transaction as the data write
// it's logging, so a write and its audit record either both commit or both
// roll back together -- pass the `tx` from that same withTenantContext call,
// never a fresh one.
type CommonLogActivityParams = {
  tx: TenantDb
  action: string
  entityType: string
  entityId: string
  details?: string
  orgId: string
  clientId?: string | null
  request?: Request
  // VERIDIAN Review Framework Wave 4, Track 1b item 2 (2026-07-18): optional
  // and backward-compatible -- every pre-existing call site (13+, per the
  // header above) passes neither field and behaves exactly as before. Set
  // only by support-session-service.ts's startSupportSession/
  // endSupportSession, and by any future call site made while a support
  // session is active, so the impersonated org's own /audit page can show
  // exactly which rows were performed by a support agent acting on their
  // behalf, under which session, without a cross-org join (see
  // schema.ts's auditLogs.supportSessionId/actingOnBehalfOfUserId columns).
  supportSession?: { id: string; actingOnBehalfOfUserId: string }
  // VERIDIAN Review Framework: Audit & Governance / Complete Audit Stamp
  // (Medium finding, task-20260718-075006). Optional override -- almost
  // every call site can leave this unset and get a real value for free
  // (see deriveSessionId below, applied automatically from `request` when
  // this isn't explicitly passed). A call site would only ever pass this
  // explicitly if it already has a more authoritative session identifier
  // in hand than what can be read off the request's own cookie header.
  sessionId?: string | null
  // Optional pass-through -- see schema.ts's auditLogs.officeId comment for
  // why this is opt-in rather than auto-derived (branches/multi-office
  // adoption is still nascent in this codebase; no auto-lookup is done
  // here to avoid an extra DB read on every single audit write).
  officeId?: string | null
}

// Wave 9: a write can now be driven by a real logged-in user OR an external
// API key (`requireAuthOrApiKey()`) -- exactly one of `dbUser`/`apiKey` must
// be supplied so every audit row still gets a real actor, never a silent
// gap. The discriminated union makes it a compile error to pass neither or
// both, rather than a runtime surprise.
export type LogActivityParams = CommonLogActivityParams &
  (
    | { dbUser: typeof users.$inferSelect; apiKey?: never }
    | { dbUser?: never; apiKey: { id: string; name: string } }
  )

function extractIp(request?: Request): string | undefined {
  if (!request) return undefined
  // x-forwarded-for can carry a chain of proxies; the client is always first.
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? undefined
}

// VERIDIAN Review Framework: Audit & Governance / Complete Audit Stamp
// (Medium finding, task-20260718-075006, "no dedicated session_id column
// ... 'machine' is approximated only by userAgent"). This closes the
// session_id half.
//
// Deliberately reads the raw `Cookie` header off the same `request` object
// extractIp/userAgent already use above -- NOT `@supabase/ssr`'s
// createServerClient()/getSession(), even though that's how every other
// part of this codebase resolves a Supabase session. Two reasons:
//   1. createServerClient() needs next/headers' cookies(), which requires
//      a real Next.js request-scoped context. logActivity() is also called
//      from src/lib/monitors/* (cron/background checks -- see
//      rule-engine-monitor.ts, dispatch-completion-monitor.ts) where
//      `request` is frequently absent entirely because there IS no HTTP
//      session for that write. Calling into next/headers there would
//      throw; reading an optional Request's headers synchronously never
//      does -- absent `request` (or absent cookie) just yields sessionId
//      = null, which is also the semantically correct value for a
//      monitor-triggered row.
//   2. This only needs a STABLE FINGERPRINT for "same browser session",
//      not the decoded JWT itself -- hashSessionToken (reused as-is from
//      session-limit-service.ts, not duplicated) is a generic string
//      hasher, so it doesn't care whether its input is a real access token
//      or an opaque cookie blob.
// Trade-off, stated honestly: hashing the whole Cookie header (rather than
// hand-parsing out just the `sb-*-auth-token` cookie and its chunk
// suffixes) is coarser -- it changes if ANY cookie on the request changes,
// not only the auth one -- but it never silently breaks if a future
// @supabase/ssr version changes its cookie naming/chunking scheme, which a
// hand-rolled parse of that internal format would risk.
// Exported for direct unit testing (audit.test.ts) -- logActivity() itself
// needs a real DB tx to test end-to-end, so this pure derivation is tested
// in isolation instead.
export function deriveSessionId(request?: Request): string | null {
  const cookieHeader = request?.headers.get("cookie")
  if (!cookieHeader) return null
  return hashSessionToken(cookieHeader)
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { tx, action, entityType, entityId, details, orgId, clientId, request, supportSession, officeId } = params

  // Denormalized snapshot, not a live join -- if this user is later renamed
  // or deactivated, this row must keep showing who they were AT THE TIME of
  // the action, not whatever the users/api_keys table says today.
  const actor = params.dbUser
    ? { userId: params.dbUser.id, actorName: params.dbUser.name, actorRole: params.dbUser.role, apiKeyId: null as string | null }
    : { userId: null as string | null, actorName: `API Key: ${params.apiKey.name}`, actorRole: "api_key", apiKeyId: params.apiKey.id }

  await tx.insert(auditLogs).values({
    action,
    entityType,
    entityId,
    userId: actor.userId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    apiKeyId: actor.apiKeyId,
    orgId,
    clientId: clientId ?? null,
    details,
    ipAddress: extractIp(request),
    userAgent: request?.headers.get("user-agent") ?? undefined,
    supportSessionId: supportSession?.id ?? null,
    actingOnBehalfOfUserId: supportSession?.actingOnBehalfOfUserId ?? null,
    sessionId: params.sessionId !== undefined ? params.sessionId : deriveSessionId(request),
    officeId: officeId ?? null,
  })
}
