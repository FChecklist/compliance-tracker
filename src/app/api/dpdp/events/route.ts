import { NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { dpdpEvent } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const events = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) =>
      tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, result.ctx.orgId), orderBy: [desc(dpdpEvent.occurredAt)], limit: 200 })
    )
    return NextResponse.json({ events })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the record")
  }
}
