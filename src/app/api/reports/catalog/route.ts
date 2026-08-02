import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getFullReportCatalog, ServiceError } from "@/lib/services/report-engine-service"

// Priority 17 remaining gap (Reports & Analysis consuming UI, 2026-07-16):
// the only real gap was a UI reading getFullReportCatalog() -- the merge
// function itself (static REPORT_CATALOG + live report_definitions rows,
// ~200 rows) already existed, consumed only by capability-tree-service.ts
// (the AI assistant's capability tree), never by a page a user can browse.
// This is that route: a thin, auth-required GET wrapper, zero new execution
// logic -- running a definition still goes through the pre-existing
// POST /api/reports/definitions/[id]/run -> executeReportDefinition()
// dispatcher, not duplicated here.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ catalog: [] })

  try {
    const catalog = await getFullReportCatalog({ orgId })
    return NextResponse.json({ catalog })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report catalog fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch report catalog" }, { status: 500 })
  }
}
