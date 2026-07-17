import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { deleteHoliday, ServiceError } from "@/lib/services/hr-attendance-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requirePermissionForUser(dbUser, "erp.hr_attendance.holiday_manage")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteHoliday({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Holiday delete error:", error)
    return NextResponse.json({ error: "Failed to delete holiday" }, { status: 500 })
  }
}
