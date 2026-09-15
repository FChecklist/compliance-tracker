import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listBreaches, reportBreach } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const breaches = await listBreaches(result.ctx.orgId)
    return NextResponse.json({ breaches })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load breach reports")
  }
}

// "🚨 Report a leak now" -- the 72-hour clock starts the moment this runs, not when the caller is sure of the facts.
export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const breach = await reportBreach(result.ctx.orgId, result.ctx.identityId, body?.scopePersonCount)
    return NextResponse.json(breach, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not report that")
  }
}
