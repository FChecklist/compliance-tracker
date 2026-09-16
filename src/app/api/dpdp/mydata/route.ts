// WO-DPDP-003 mockup's "🔐 What you hold about me" -- staff's own view of
// their own footprint. Reuses listMyObligations rather than a new query.
import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { listMyObligations } from "@/lib/services/dpdp-obligation-service"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const email = await resolveIdentityLabel(result.ctx.identityId)
    const jobs = await listMyObligations(result.ctx.orgId, result.ctx.identityId)
    return NextResponse.json({
      email,
      jobsWritten: jobs.filter((j) => j.state !== "open").length,
      jobsTotal: jobs.length,
    })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load what we hold about you")
  }
}
