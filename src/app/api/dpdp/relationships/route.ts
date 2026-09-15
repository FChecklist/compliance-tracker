import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { nameDpdpRelationship } from "@/lib/services/dpdp-organisation-service"
import { listRelationshipsForOrg, listServedByOrg } from "@/lib/services/dpdp-relationship-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

// ?as=served -- "Who we work for" (I am the processor/auditor/advisor);
// default -- "Outside firms" / "Our clients" (relationships pointing at me).
export async function GET(request: Request) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const as = new URL(request.url).searchParams.get("as")
    const relationships = as === "served" ? await listServedByOrg(result.ctx.orgId) : await listRelationshipsForOrg(result.ctx.orgId)
    return NextResponse.json({ relationships })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load relationships")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can name an outside firm or client" }, { status: 403 })
  try {
    const body = await request.json()
    const relationship = await nameDpdpRelationship({
      actorOrgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId,
      counterpartOrgName: body?.counterpartOrgName ?? "", counterpartEmail: body?.counterpartEmail ?? "",
      kind: body?.kind ?? "processes_for", scope: body?.scope,
    })
    return NextResponse.json(relationship, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not name that")
  }
}
