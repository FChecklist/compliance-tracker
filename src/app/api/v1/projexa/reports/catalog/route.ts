import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getFullReportCatalog, ServiceError } from "@/lib/services/report-engine-service"
import { withRouteTiming } from "@/lib/route-timing"

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16, 2026-07-16 follow-on to #375, which
// built this exact consuming pattern only for compliance-tracker's own
// /reports page). Thin GET alias, zero new execution logic -- wraps the
// SAME getFullReportCatalog() #375 already wired up (src/app/api/reports/
// catalog/route.ts). requireAuthOrApiKey (not requireAuth, unlike #375's
// route) because PROJEXA calls this server-to-server with a Bearer vk_...
// API key, never a browser session -- matches every other /v1/projexa/*
// route's auth pattern (see quotations/route.ts, companies/route.ts).
// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const catalog = await getFullReportCatalog({ orgId: ctx.orgId })
    return NextResponse.json({ catalog })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa report catalog fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch report catalog" }, { status: 500 })
  }
}
