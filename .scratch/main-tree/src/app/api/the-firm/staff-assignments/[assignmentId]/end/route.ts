import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { endStaffAssignment, ServiceError } from "@/lib/services/firm-staff-assignment-service"

export async function POST(req: NextRequest, ctx: { params: Promise<{ assignmentId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { assignmentId } = await ctx.params
    const body = await req.json()
    if (!body.endDate) return NextResponse.json({ error: "endDate is required" }, { status: 400 })
    const assignment = await endStaffAssignment({ orgId, userId: dbUser.id, dbUser }, assignmentId, body.endDate)
    return NextResponse.json(assignment)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("End staff assignment error:", error)
    return NextResponse.json({ error: "Failed to end staff assignment" }, { status: 500 })
  }
}
