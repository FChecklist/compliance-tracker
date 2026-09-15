import { NextRequest, NextResponse } from "next/server"
import { recordConsent } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await request.json()
    const records = await recordConsent(token, Array.isArray(body?.purposes) ? body.purposes : [], body?.language ?? "en")
    return NextResponse.json({ records })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not save your answer")
  }
}
