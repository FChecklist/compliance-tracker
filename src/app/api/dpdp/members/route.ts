// "Adding someone" -- way ① (invite by email). Only an owner may invite.
import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { inviteDpdpMember } from "@/lib/services/dpdp-organisation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { and, eq } from "drizzle-orm"
import { db, dpdpMembership, dpdpIdentityEmail } from "@/lib/db"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const members = await db.query.dpdpMembership.findMany({ where: eq(dpdpMembership.orgId, result.ctx.orgId) })
    const withEmails = await Promise.all(members.map(async (m) => {
      const email = await db.query.dpdpIdentityEmail.findFirst({ where: and(eq(dpdpIdentityEmail.identityId, m.identityId), eq(dpdpIdentityEmail.isPrimary, true)) })
      return { ...m, email: email?.email ?? null }
    }))
    return NextResponse.json({ members: withEmails })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not list people")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can add people" }, { status: 403 })

  try {
    const body = await request.json()
    const membership = await inviteDpdpMember({ orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId, email: body?.email ?? "", level: body?.level ?? "staff" })
    return NextResponse.json({ membership }, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not invite that person")
  }
}
