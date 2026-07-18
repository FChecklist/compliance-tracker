import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { searchAuditTrail, type AuditSearchRow } from "@/lib/services/audit-search-service"

// VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail & Change
// History" -- unified cross-table audit search over audit_logs/
// orchestra_executions/activity_log. Same gating posture as the existing
// single-table /api/audit route (requireAuth only, org-scoped by RLS) --
// this view intentionally exposes only non-sensitive columns per source
// (status/objective, never raw orchestra_executions.input/output text), so
// it carries no more exposure than /api/audit already grants any
// authenticated org member.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ results: [] })

  const { searchParams } = request.nextUrl
  const sourceTablesParam = searchParams.get("sourceTables")
  const sourceTables = sourceTablesParam
    ? (sourceTablesParam.split(",").filter(Boolean) as AuditSearchRow["sourceTable"][])
    : undefined

  try {
    const results = await searchAuditTrail(
      { orgId },
      {
        sourceTables,
        actionContains: searchParams.get("actionContains") || undefined,
        entityType: searchParams.get("entityType") || undefined,
        entityId: searchParams.get("entityId") || undefined,
        userId: searchParams.get("userId") || undefined,
        fromDate: searchParams.get("fromDate") ? new Date(searchParams.get("fromDate")!) : undefined,
        toDate: searchParams.get("toDate") ? new Date(searchParams.get("toDate")!) : undefined,
        limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      }
    )
    return NextResponse.json({ results })
  } catch (error) {
    console.error("Audit search error:", error)
    return NextResponse.json({ error: "Failed to search audit trail" }, { status: 500 })
  }
}
