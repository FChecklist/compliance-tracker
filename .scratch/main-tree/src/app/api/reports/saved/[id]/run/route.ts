import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runReport, ServiceError } from "@/lib/services/custom-report-service"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await runReport({ orgId }, id)

    // D15.B2.S1 named event #3, "Report Generated -> Report Audit". runReport()
    // itself takes no actor (reports aren't otherwise audit-logged), so this
    // is recorded here at the route, in its own transaction, fire-and-forget
    // -- must never block or fail the report the caller is waiting on.
    if (dbUser) {
      void withTenantContext({ orgId, userId: dbUser.id }, (db) =>
        recordAuditTrigger({ tx: db, event: "report_generated", entityType: "saved_report", entityId: id, orgId, dbUser })
      ).catch((err) => console.error(`[audit-trigger] failed to record report_generated for report ${id}:`, err))
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report run error:", error)
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 })
  }
}
