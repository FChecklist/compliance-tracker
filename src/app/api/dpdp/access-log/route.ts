// WO-DPDP-003 Section 4.8 -- "who looked at what" (deliberately separate
// from dpdp.event, "the record": this one is 13-months/high-volume, that
// one is permanent/human-readable). Nothing in this repo writes to
// dpdp.access_log yet (checked directly) -- this route will legitimately
// return an empty list until a real read-path starts logging to it. That's
// a genuine gap, not something this route fakes; flagged, not backfilled.
import { NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { dpdpAccessLog } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const entries = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) =>
      tx.query.dpdpAccessLog.findMany({ where: eq(dpdpAccessLog.orgId, result.ctx.orgId), orderBy: [desc(dpdpAccessLog.at)], limit: 500 }),
    )
    return NextResponse.json({ entries })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the access log")
  }
}
