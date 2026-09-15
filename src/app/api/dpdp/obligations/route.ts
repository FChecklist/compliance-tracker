import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listObligations, listMyObligations } from "@/lib/services/dpdp-obligation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

// ?mine=1 -- "My jobs" (only what's assigned to me); otherwise the full
// "to-do list" (owner-only view in the UI layer, not enforced here since
// staff simply won't be shown the link -- same posture the rest of this
// app takes for read visibility vs write authorization).
export async function GET(request: Request) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const mine = new URL(request.url).searchParams.get("mine") === "1"
    const obligations = mine
      ? await listMyObligations(result.ctx.orgId, result.ctx.identityId)
      : await listObligations(result.ctx.orgId)
    return NextResponse.json({ obligations })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load jobs")
  }
}
