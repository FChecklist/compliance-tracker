// VERIDIAN Review Framework gap-closure, "Reporting & Export Accuracy":
// report_definitions already has built, executable "Lead Register"/"Lead
// Source Report"/"Lead Status Report" rows -- the genuine gap was that
// nothing in this codebase could emit CSV, and there was no export action
// on the CRM UI itself. Query params mirror GET /api/crm/leads' own
// filters, so "export what I'm currently looking at" works.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { exportLeadsCsv, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const url = new URL(request.url)
  try {
    const csv = await exportLeadsCsv({ orgId }, {
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      companyId: url.searchParams.get("companyId") ?? undefined,
    })
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM leads export error:", error)
    return NextResponse.json({ error: "Failed to export leads" }, { status: 500 })
  }
}
