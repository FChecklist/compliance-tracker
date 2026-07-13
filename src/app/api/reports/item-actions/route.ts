import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createReportItemAction, listReportItemActions, ServiceError } from "@/lib/services/report-item-action-service"

// GET ?reportId=<id> -- the action trail for one report's rows (accept/
// delegate/todo, whoever did it, and what real row it points at).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ actions: [] })

  const reportId = request.nextUrl.searchParams.get("reportId")
  if (!reportId) return NextResponse.json({ error: "reportId query param is required" }, { status: 400 })

  try {
    const actions = await listReportItemActions({ orgId }, reportId)
    return NextResponse.json({ actions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report item actions list error:", error)
    return NextResponse.json({ error: "Failed to fetch report item actions" }, { status: 500 })
  }
}

// POST -- records that the current user took `action` on report row
// (reportId, rowId). targetId, when present, is the real delegation or
// task id the CLIENT already created via /api/delegations or /api/tasks
// before calling this -- this route never creates either of those itself.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createReportItemAction({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report item action create error:", error)
    return NextResponse.json({ error: "Failed to create report item action" }, { status: 500 })
  }
}
