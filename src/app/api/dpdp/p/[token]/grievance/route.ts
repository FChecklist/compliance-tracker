import { NextRequest, NextResponse } from "next/server"
import { resolveConsentToken, raiseGrievance } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const ctx = await resolveConsentToken(token)
    if (!ctx) return NextResponse.json({ error: "This link is not valid or has expired" }, { status: 404 })
    const body = await request.json()
    const grievance = await raiseGrievance(ctx.orgId, body?.summary ?? "")
    return NextResponse.json(grievance, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not raise that complaint")
  }
}
