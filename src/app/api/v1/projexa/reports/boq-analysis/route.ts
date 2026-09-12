import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getProjectAnalysis, listOrgAnalysis, sortAnalysisRows, type AnalysisSortKey } from "@/lib/services/boq-analysis-service"
import { ServiceError } from "@/lib/services/compliance-service"

// R85 Addendum 3 v4 (claude_log 379), Phase 9 -- THE ANALYSIS SCREEN (spec
// Part F, gates 9-01..9-07; use case B3 -- "did we make the margin we
// quoted, and where did it go"). GET-only (9-05: nothing on this screen is
// ever editable -- there is deliberately no POST/PUT/DELETE handler in this
// file, not merely an unused one).
//
// WHY THIS IS A NEW DEDICATED ROUTE, NOT A NEW REPORT_REGISTRY ENTRY
// (investigated per this phase's own instructions before choosing this
// path): src/app/api/v1/projexa/reports/[reportName]/route.ts
// (construction-reports-service.ts's REPORT_REGISTRY dispatcher) was the
// obvious first candidate -- it already is a per-project/cross-project
// report mechanism. Two real, structural mismatches ruled it out, not a
// stylistic preference:
//   1. That dispatcher HARD-REQUIRES a projectId query param for every
//      report name (400 without one) with no cross-project mode at all --
//      but 9-02 needs the OPPOSITE as its primary shape (one row per
//      project, no projectId). Making projectId optional there would
//      change behaviour for the ~19 other report names sharing that one
//      check, well outside this phase's declared scope.
//   2. That dispatcher's role gating is ad hoc per report name -- only
//      "budget-vs-actual" gets an inline hasRole() check; every other
//      report (including margin-adjacent ones like Scope/Budget Summary)
//      has no route-level role gate at all. 9-07 requires "the ROUTE is
//      refused, not a column hidden" for a client role -- bolting a hard,
//      unconditional role floor onto ONE report name inside a shared
//      dispatcher file, without touching the other ~19, is a worse shape
//      than a small route with its own clean gate from the start.
// This route therefore matches ACTIVE-CLAIMS.yaml's declared default path
// rather than deviating into the catalog mechanism. A discoverability entry
// was still added to report-catalog-service.ts's REPORT_CATALOG (a
// data-only listing, no execution logic) so this report is not invisible to
// that catalog even though it does not execute through REPORT_REGISTRY.
//
// ROLE FLOOR: "manager" (rank 3), matching the [reportName] dispatcher's own
// precedent for this exact class of data -- "budget-vs-actual" (the only
// other report exposing margin/budget figures) is gated at the same floor.
// This refuses every rank-1 role (viewer/client_viewer/external_auditor/
// stage_0) AND rank-2 (member) -- stricter than this codebase's usual GET
// floor of "member" because profit margin is, per the work order's own
// words, "the single most valuable screen in the product for an owner",
// materially more sensitive than the plain financial dashboards gated at
// "member" elsewhere in this codebase.
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")

  try {
    if (projectId) {
      const row = await getProjectAnalysis({ orgId: ctx.orgId }, projectId)
      return NextResponse.json({ row })
    }

    const rows = await listOrgAnalysis({ orgId: ctx.orgId })
    const sortByParam = request.nextUrl.searchParams.get("sortBy")
    const validSortKeys: AnalysisSortKey[] = ["profitOnGross", "profitOnGrossPercent", "profitOnNetReceivable", "profitOnNetReceivablePercent"]
    const sortBy: AnalysisSortKey = validSortKeys.includes(sortByParam as AnalysisSortKey) ? (sortByParam as AnalysisSortKey) : "profitOnGross"
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc"

    return NextResponse.json({ rows: sortAnalysisRows(rows, sortBy, direction) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-analysis report error:", error)
    return NextResponse.json({ error: "Failed to generate the analysis report" }, { status: 500 })
  }
}
