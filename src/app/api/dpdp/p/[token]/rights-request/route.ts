import { NextRequest, NextResponse } from "next/server"
import { resolveConsentToken, raiseRightsRequest } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

// "See what you hold" / "correct it" / "ask them to delete it" / "name
// someone to act for me" -- all the same shape, distinguished by `kind`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const ctx = await resolveConsentToken(token)
    if (!ctx) return NextResponse.json({ error: "This link is not valid or has expired" }, { status: 404 })
    const body = await request.json()
    const request_ = await raiseRightsRequest({ orgId: ctx.orgId, kind: body?.kind ?? "access", arrivedVia: "principal_link" })
    return NextResponse.json(request_, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not raise that request")
  }
}
