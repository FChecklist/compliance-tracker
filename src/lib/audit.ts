import { auditLogs, type users } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"

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

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { tx, action, entityType, entityId, details, orgId, clientId, request } = params

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
  })
}
