import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { bulkMarkAttendance, ServiceError } from "@/lib/services/hr-attendance-service"

// Manager/HR bulk-mark: one status applied to many employees for a single
// date (e.g. marking an entire department present for an off-site day).
// Always manager-gated, unlike the single-mark POST /api/hr/attendance
// route (which allows self-marking without the role check).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const results = await bulkMarkAttendance({ orgId, userId: dbUser.id }, {
      date: body.date, userIds: body.userIds, status: body.status, notes: body.notes,
    })
    return NextResponse.json({ records: results }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Bulk attendance mark error:", error)
    return NextResponse.json({ error: "Failed to bulk-mark attendance" }, { status: 500 })
  }
}
