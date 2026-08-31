import { NextRequest, NextResponse } from "next/server"
import { notifyOverdueLeadFollowUpsForAllOrgs } from "@/lib/services/crm-service"

/**
 * Cron-triggered entry point (VERIDIAN Review Framework gap-closure,
 * "Notification & Alert Trigger Correctness"): no notification ever fired
 * for an overdue lead nextActionDate. Once daily, notify each overdue
 * lead's owner across every org with Sales enabled. Same shared-secret
 * pattern as every other /api/internal/*\/run route.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await notifyOverdueLeadFollowUpsForAllOrgs()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("CRM lead follow-up alert run failed:", error)
    return NextResponse.json({ error: "CRM lead follow-up alert run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
