import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireReportsReadAccess } from "@/lib/supabase/auth-guard"
import { executeReportDefinition, ServiceError } from "@/lib/services/report-engine-service"
import { rowsToCSV, rowsToXLSXBuffer } from "@/lib/report-export-shared"

type RouteContext = { params: Promise<{ id: string }> }

// task-20260727-101145 (external-AI-facing reporting API gateway). The one
// real execution endpoint every report_definitions row runs through
// (report-engine-service.ts's executeReportDefinition), reachable by an
// external AI/reseller app via a scoped `read`/`read:reports` API key --
// same dispatcher src/app/api/reports/definitions/[id]/run/route.ts
// (session-auth) and src/app/api/v1/projexa/reports/definitions/[id]/run/
// route.ts (PROJEXA-scoped) already call. No second engine here.
//
// STRICT_TENANT_ISOLATION (the Owner's explicit top requirement for this
// task): `orgId` passed into executeReportDefinition() is ALWAYS
// `ctx.orgId`, resolved exclusively from the authenticated session/API key
// by requireAuthOrApiKey() -- never from the request body or query string.
// Any `orgId`/`params.orgId` a caller sends in the POST body is silently
// ignored, not merged in -- this is the one thing this route is
// responsible for getting right; withTenantContext()'s RLS enforcement
// inside executeReportDefinition() (already relied on at ~30 other call
// sites) does the rest.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const scopeErr = requireReportsReadAccess(ctx)
  if (scopeErr) return scopeErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
    const result = await executeReportDefinition({ orgId: ctx.orgId, userId: actorId }, id, body.params ?? {})

    const format = request.nextUrl.searchParams.get("format")?.toLowerCase()
    if (format === "csv") {
      return new NextResponse(rowsToCSV(result.rows), {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="report-${id}.csv"`,
        },
      })
    }
    if (format === "xlsx" || format === "excel") {
      // Wrapped in a Blob rather than passed as a raw Buffer -- NextResponse's
      // BodyInit type doesn't line up with the Buffer<ArrayBufferLike>
      // generic this TS config produces from the xlsx package's buffer
      // output, but Blob is unambiguously a valid BodyInit (same fix as
      // src/app/api/v1/projexa/payroll/payslips/[id]/pdf/route.ts).
      return new NextResponse(new Blob([Uint8Array.from(rowsToXLSXBuffer(result.rows))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="report-${id}.xlsx"`,
        },
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 reports definition execute error:", error)
    return NextResponse.json({ error: "Failed to run report definition" }, { status: 500 })
  }
}
