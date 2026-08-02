import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listHolidays, addHoliday, ServiceError } from "@/lib/services/hr-attendance-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ holidays: [] })

  try {
    const yearParam = request.nextUrl.searchParams.get("year")
    const holidays = await listHolidays({ orgId }, yearParam ? Number(yearParam) : undefined)
    return NextResponse.json({ holidays })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Holiday list error:", error)
    return NextResponse.json({ error: "Failed to fetch holidays" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requirePermissionForUser(dbUser, "erp.hr_attendance.holiday_manage")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await addHoliday({ orgId, userId: dbUser.id }, { date: body.date, name: body.name })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Holiday create error:", error)
    return NextResponse.json({ error: "Failed to create holiday" }, { status: 500 })
  }
}
