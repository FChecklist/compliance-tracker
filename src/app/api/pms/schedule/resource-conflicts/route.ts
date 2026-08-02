// Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
// "Resource-allocation conflict/over-allocation detection", org-wide
// (across every project, not just one) -- see schedule-service.ts's
// detectResourceConflicts() for why this is distinct from
// /api/pms/schedule/resource-allocations' existing per-project getWorkload().
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled } from "@/lib/services/pms-enablement-service"
import { getResourceConflicts, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const userId = request.nextUrl.searchParams.get("userId") ?? undefined
  const capacityParam = request.nextUrl.searchParams.get("dailyCapacityHours")

  try {
    await requirePmsEnabled(ctx.orgId)
    const conflicts = await getResourceConflicts({ orgId: ctx.orgId }, {
      userId,
      dailyCapacityHours: capacityParam ? Number(capacityParam) : undefined,
    })
    return NextResponse.json({ conflicts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("pms resource-conflicts error:", error)
    return NextResponse.json({ error: "Failed to compute resource conflicts" }, { status: 500 })
  }
}
