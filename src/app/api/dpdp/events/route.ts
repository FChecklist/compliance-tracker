import { NextRequest, NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { dpdpEvent } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

// WO-DPDP-003 Section 9(c): "export the whole record" (the Proof screen's
// export, and the standalone-verifier input) must not be silently capped at
// 200 -- ?all=1 lifts the limit. Left off by default so the normal "record"
// screen keeps loading fast.
export async function GET(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const all = request.nextUrl.searchParams.get("all") === "1"
    const events = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) =>
      tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, result.ctx.orgId), orderBy: [desc(dpdpEvent.occurredAt)], ...(all ? {} : { limit: 200 }) })
    )
    return NextResponse.json({ events })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the record")
  }
}
