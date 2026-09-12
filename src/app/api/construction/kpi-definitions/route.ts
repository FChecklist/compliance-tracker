import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listKpiDefinitions, createKpiDefinition, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ definitions: [] })

  try {
    const definitions = await listKpiDefinitions({ orgId }, request.nextUrl.searchParams.get("projectId") ?? undefined)
    return NextResponse.json({ definitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI definitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // construction-kpi-service.ts's own header comment documents "submit is
  // the 'member' rank" -- matches kpi-entries/route.ts's POST gate, which
  // enforces exactly that; this sibling route (KPI definitions, not
  // entries) never actually enforced it despite the documented intent.
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await createKpiDefinition({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI definition create error:", error)
    return NextResponse.json({ error: "Failed to create KPI definition" }, { status: 500 })
  }
}
