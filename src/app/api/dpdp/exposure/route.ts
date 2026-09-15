import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { getExposureEstimate, saveExposureEstimate, listBands } from "@/lib/services/dpdp-exposure-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const [estimate, bands] = await Promise.all([getExposureEstimate(result.ctx.orgId), listBands()])
    // Deliberately strips annual_paise -- band PRICING is reserved to the
    // Owner (work order #11) and this route must never leak it, seeded or
    // not, to a browser.
    return NextResponse.json({ estimate: estimate ?? null, bands: bands.map(({ annualPaise: _annualPaise, ...b }) => b) })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load exposure")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const estimate = await saveExposureEstimate(result.ctx.orgId, {
      employees: Number(body?.employees) || 0, customers: Number(body?.customers) || 0, applicants: Number(body?.applicants) || 0,
      cctvMonthly: Number(body?.cctvMonthly) || 0, other: Number(body?.other) || 0, vendorCount: Number(body?.vendorCount) || 0,
      vendorStaffEach: Number(body?.vendorStaffEach) || 0, advisorCount: Number(body?.advisorCount) || 0,
    })
    return NextResponse.json(estimate)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not save that")
  }
}
