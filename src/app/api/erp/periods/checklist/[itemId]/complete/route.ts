import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { completeChecklistItem, ServiceError } from "@/lib/services/erp-financial-report-service"

type RouteContext = { params: Promise<{ itemId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: completing checklist items is part of the period-close process
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_year.checklist_complete")
  if (roleErr) return roleErr

  try {
    const { itemId } = await params
    const body = await request.json().catch(() => ({}))
    const item = await completeChecklistItem({ orgId, userId: dbUser.id }, itemId, body.notes)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period checklist item complete error:", error)
    return NextResponse.json({ error: "Failed to complete checklist item" }, { status: 500 })
  }
}
