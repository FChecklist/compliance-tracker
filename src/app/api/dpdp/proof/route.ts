// WO-DPDP-003 Section 5.2 -- the Proof screen's headline numbers, reusing
// verifyDpdpEventChain (dpdp-event-service.ts) rather than re-deriving chain
// logic here. `asOf` (IMG-002, the date picker) is accepted but only
// affects artefact-backed views -- dpdp.event itself has no effective_to,
// it's an append-only log, not a bitemporal table, so "what was true on
// date X" for the record itself is simply "every event up to X", handled
// by the existing GET /api/dpdp/events (see its own ?all=1 addition).
import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import { dpdpEvent } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { verifyDpdpEventChain } from "@/lib/services/dpdp-event-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const orgId = result.ctx.orgId
    const stats = await withDpdpContext({ orgId }, (tx) =>
      tx
        .select({
          entries: sql<number>`count(*)`,
          people: sql<number>`count(distinct ${dpdpEvent.actorIdentityId})`,
          firstEntry: sql<string | null>`min(${dpdpEvent.occurredAt})`,
          lastHash: sql<string | null>`(array_agg(${dpdpEvent.hash} order by ${dpdpEvent.occurredAt} desc))[1]`,
        })
        .from(dpdpEvent)
        .where(eq(dpdpEvent.orgId, orgId)),
    )
    const row = stats[0]
    const chain = await verifyDpdpEventChain(orgId)
    const firstEntry = row.firstEntry ? new Date(row.firstEntry) : null
    const daysOfRecord = firstEntry ? Math.max(0, Math.floor((Date.now() - firstEntry.getTime()) / 86400000)) : 0
    const keptUntil = firstEntry ? new Date(firstEntry.getTime() + 10 * 365.25 * 86400000).toISOString() : null

    return NextResponse.json({
      entries: Number(row.entries) || 0,
      daysOfRecord,
      people: Number(row.people) || 0,
      firstEntry: firstEntry?.toISOString() ?? null,
      keptUntil,
      chainIntact: chain.ok,
      brokenAtEventId: chain.brokenAtEventId,
      checked: chain.checked,
      headHash: row.lastHash ?? null,
    })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the proof record")
  }
}
