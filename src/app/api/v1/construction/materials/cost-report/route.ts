// Real-screen conversion (2026-08-30): the real backend for the "Cost
// Report" tab -- PROJEXA's proxy (api/construction-materials/cost-report/
// route.ts) has called this exact path since R52 and always gotten a 502,
// because nothing here ever implemented it. Same requireAuthOrApiKey shape
// as ../route.ts / ../receipts/route.ts (PROJEXA calls this with a Bearer
// API key, root:true, never re-exported under v1/projexa/*).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getMaterialCostReport, ServiceError } from "@/lib/services/construction-materials-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    // R67 E-05 (R-103): the report now takes a period and a grouping. All
    // three are optional, so the pre-existing caller shape
    // (?projectId=... alone) still answers -- with every receipt, grouped by
    // material, exactly as before.
    const report = await getMaterialCostReport({ orgId: ctx.orgId }, projectId, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      groupBy: searchParams.get("groupBy") === "vendor" ? "vendor" : "material",
    })
    return NextResponse.json({ report })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction materials cost-report error:", error)
    return NextResponse.json({ error: "Failed to fetch material cost report" }, { status: 500 })
  }
}
