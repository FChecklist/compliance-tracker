import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getFullReportCatalog, ServiceError } from "@/lib/services/report-engine-service"

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16, 2026-07-16 follow-on to #375, which
// built this exact consuming pattern only for compliance-tracker's own
// /reports page). Thin GET alias, zero new execution logic -- wraps the
// SAME getFullReportCatalog() #375 already wired up (src/app/api/reports/
// catalog/route.ts). requireAuthOrApiKey (not requireAuth, unlike #375's
// route) because PROJEXA calls this server-to-server with a Bearer vk_...
// API key, never a browser session -- matches every other /v1/projexa/*
// route's auth pattern (see quotations/route.ts, companies/route.ts).
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ catalog: [] })

  try {
    const catalog = await getFullReportCatalog({ orgId: ctx.orgId })
    return NextResponse.json({ catalog })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa report catalog fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch report catalog" }, { status: 500 })
  }
}
