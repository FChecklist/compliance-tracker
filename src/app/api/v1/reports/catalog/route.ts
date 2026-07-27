import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireReportsReadAccess } from "@/lib/supabase/auth-guard"
import { getFullReportCatalog, ServiceError } from "@/lib/services/report-engine-service"

// task-20260727-101145 (external-AI-facing reporting API gateway, Owner
// directive CRITICAL_ERP_REPORTING_MODULE_WITH_AI_API_INTEGRATION): the
// generic, product-agnostic sibling of src/app/api/v1/projexa/reports/
// catalog/route.ts (PROJEXA-specific, pre-existing) -- this is the path
// an external AI (ChatGPT/z.ai), a customer's own AI, or a reseller's app
// hits directly, not funneled through PROJEXA's product surface. Zero new
// execution logic: wraps the SAME getFullReportCatalog() every other
// consumer already uses (the ~200-row report_definitions catalog + static
// REPORT_CATALOG merge, report-engine-service.ts).
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const scopeErr = requireReportsReadAccess(ctx)
  if (scopeErr) return scopeErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const catalog = await getFullReportCatalog({ orgId: ctx.orgId })
    return NextResponse.json({ catalog })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 reports catalog fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch report catalog" }, { status: 500 })
  }
}
