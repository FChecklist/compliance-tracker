import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { dpdpPrincipalGroup } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const groups = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) => tx.query.dpdpPrincipalGroup.findMany({ where: eq(dpdpPrincipalGroup.orgId, result.ctx.orgId) }))
    return NextResponse.json({ groups })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load groups")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    if (!body?.label?.trim()) return NextResponse.json({ error: "A label is required" }, { status: 400 })
    const [group] = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) =>
      tx.insert(dpdpPrincipalGroup).values({ orgId: result.ctx.orgId, label: body.label.trim(), estCount: body.estCount }).returning()
    )
    return NextResponse.json(group, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not create that group")
  }
}
