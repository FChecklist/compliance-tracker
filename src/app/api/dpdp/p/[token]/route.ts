// Public, token-in-URL, no session -- "a person on a link" (work order
// 4.5 / this repo's TOKEN_SCOPED precedent, client-portal deliverables).
// Never requires requireDpdpSession(): the entire point of this surface is
// that a Data Principal never has one.
import { NextResponse } from "next/server"
import { resolveConsentToken } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const ctx = await resolveConsentToken(token)
    if (!ctx) return NextResponse.json({ error: "This link is not valid or has expired" }, { status: 404 })
    return NextResponse.json({ notice: ctx.notice, orgId: ctx.orgId, openedAt: ctx.token.openedAt, actedAt: ctx.token.actedAt })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not open that link")
  }
}
