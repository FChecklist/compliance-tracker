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
export type LogActivityParams = {
  tx: TenantDb
  action: string
  entityType: string
  entityId: string
  details?: string
  orgId: string
  clientId?: string | null
  dbUser: typeof users.$inferSelect
  request?: Request
}

function extractIp(request?: Request): string | undefined {
  if (!request) return undefined
  // x-forwarded-for can carry a chain of proxies; the client is always first.
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? undefined
}

export async function logActivity({
  tx,
  action,
  entityType,
  entityId,
  details,
  orgId,
  clientId,
  dbUser,
  request,
}: LogActivityParams): Promise<void> {
  await tx.insert(auditLogs).values({
    action,
    entityType,
    entityId,
    userId: dbUser.id,
    // Denormalized snapshot, not a live join -- if this user is later
    // renamed or deactivated, this row must keep showing who they were AT
    // THE TIME of the action, not whatever the users table says today.
    actorName: dbUser.name,
    actorRole: dbUser.role,
    orgId,
    clientId: clientId ?? null,
    details,
    ipAddress: extractIp(request),
    userAgent: request?.headers.get("user-agent") ?? undefined,
  })
}
