import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAttendance, markAttendance, ServiceError } from "@/lib/services/hr-attendance-service"
import { resolveAttendanceViewerScope } from "@/lib/services/hr-attendance-access"
import { requirePermissionForUser } from "@/lib/services/permission-service"

// Access control: below-manager requesters are always scoped to their own
// records, whether or not they explicitly asked for someone else's --
// resolveAttendanceViewerScope() also throws a 403 if they explicitly named
// a *different* user. See hr-attendance-access.ts for the full rationale
// (this closes a real gap: this route previously had no role check at all,
// so any authenticated org member could pass ?userId=<anyone> or omit the
// filter entirely to read every employee's attendance).
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ records: [] })

  try {
    const params = request.nextUrl.searchParams
    const scopedUserId = resolveAttendanceViewerScope(dbUser, params.get("userId") || undefined)
    const records = await listAttendance({ orgId }, {
      userId: scopedUserId,
      departmentId: params.get("departmentId") || undefined,
      companyId: params.get("companyId") || undefined,
      startDate: params.get("startDate") || undefined,
      endDate: params.get("endDate") || undefined,
    })
    return NextResponse.json({ records })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Attendance list error:", error)
    return NextResponse.json({ error: "Failed to fetch attendance records" }, { status: 500 })
  }
}

// Direct mark/correct for a single employee/day. Self-marking is always
// allowed (an employee correcting their own day); marking someone else's
// attendance requires manager-or-above, matching decideLeaveRequest's own
// role gate in src/app/api/hr/leave-requests/[id]/route.ts.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const targetUserId = body.userId || dbUser.id
    if (targetUserId !== dbUser.id) {
      const roleErr = requirePermissionForUser(dbUser, "erp.hr_attendance.mark_other")
      if (roleErr) return roleErr
    }
    const result = await markAttendance({ orgId, userId: dbUser.id }, targetUserId, {
      date: body.date, status: body.status, checkInAt: body.checkInAt, checkOutAt: body.checkOutAt,
      hoursWorked: body.hoursWorked, notes: body.notes,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Attendance mark error:", error)
    return NextResponse.json({ error: "Failed to mark attendance" }, { status: 500 })
  }
}
