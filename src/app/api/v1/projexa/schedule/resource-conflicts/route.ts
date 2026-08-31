// Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
// thin alias over schedule-service.ts's getResourceConflicts(), same
// "no requirePmsEnabled() gate" convention as this directory's other
// routes (Wave 140) -- pms_resource_allocations is PROJEXA's generic
// scheduling substrate, not gated behind the separately-purchased PMS
// product branch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getResourceConflicts, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const userId = request.nextUrl.searchParams.get("userId") ?? undefined
  const capacityParam = request.nextUrl.searchParams.get("dailyCapacityHours")

  try {
    const conflicts = await getResourceConflicts({ orgId: ctx.orgId }, {
      userId,
      dailyCapacityHours: capacityParam ? Number(capacityParam) : undefined,
    })
    return NextResponse.json({ conflicts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa resource-conflicts error:", error)
    return NextResponse.json({ error: "Failed to compute resource conflicts" }, { status: 500 })
  }
}
