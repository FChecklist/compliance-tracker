import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBusinessHoursSchedules, createBusinessHoursSchedule, ServiceError } from "@/lib/services/ticket-service"

// Helpdesk gap-closure (tiered SLA + team routing, Phase 0 2026-07-27):
// admin CRUD for the business-hours windows an SLA policy can opt into
// (businessHoursOnly) -- see computeSlaDeadline in ticket-service.ts.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ schedules: [] })

  try {
    const schedules = await listBusinessHoursSchedules({ orgId })
    return NextResponse.json({ schedules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business hours schedules list error:", error)
    return NextResponse.json({ error: "Failed to fetch business hours schedules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const schedule = await createBusinessHoursSchedule({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(schedule, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business hours schedule create error:", error)
    return NextResponse.json({ error: "Failed to create business hours schedule" }, { status: 500 })
  }
}
