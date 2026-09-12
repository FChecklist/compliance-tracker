import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listReportDefinitions, createReportDefinition, ServiceError } from "@/lib/services/report-engine-service"

// GET ?category=<cat>&classification=<cls> -- every definition visible to
// this org (its own + every platform-wide one), per the Reports & Analysis
// Engine (Priority 11).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ definitions: [] })

  const category = request.nextUrl.searchParams.get("category") ?? undefined
  const classification = request.nextUrl.searchParams.get("classification") ?? undefined

  try {
    const definitions = await listReportDefinitions({ orgId }, { category, classification })
    return NextResponse.json({ definitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch report definitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G4 reports): had no role check at all. A report
  // definition's executionConfig resolves against report-engine-service.ts's
  // own TABLE_REGISTRY (28+ tables spanning ERP financials, CRM, construction)
  // -- the SAME registry custom-charts/route.ts's createCustomChart() config
  // resolves against, and that sibling POST is gated requireRole(dbUser,
  // "manager"). Matches it: same registry, same "config that can define
  // access to financial data" stakes, same minimum.
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await createReportDefinition({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definition create error:", error)
    return NextResponse.json({ error: "Failed to create report definition" }, { status: 500 })
  }
}
