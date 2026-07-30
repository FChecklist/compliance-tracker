// CRM-007 "Sales Representative Performance Dashboard" (sap_mapping.sqlite
// sap_reports, module CRM, LOW priority, BUILD_NEW as of 2026-07-28) -- thin
// alias over crm-service.ts's getSalesRepPerformanceDashboard, same
// requireAuthOrApiKey/route shape as the sibling /api/v1/projexa/
// sales-pipeline route. Optional periodStart/periodEnd (YYYY-MM-DD) and a
// comma-separated ownerIds filter, matching this file's own optional-filter
// convention elsewhere in this codebase (e.g. listLeadsPaged's opts).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getSalesRepPerformanceDashboard, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const periodStart = request.nextUrl.searchParams.get("periodStart") || undefined
    const periodEnd = request.nextUrl.searchParams.get("periodEnd") || undefined
    const ownerIdsParam = request.nextUrl.searchParams.get("ownerIds")
    const ownerIds = ownerIdsParam ? ownerIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined

    const dashboard = await getSalesRepPerformanceDashboard({ orgId: ctx.orgId }, { periodStart, periodEnd, ownerIds })
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-rep-performance error:", error)
    return NextResponse.json({ error: "Failed to generate sales representative performance dashboard" }, { status: 500 })
  }
}
