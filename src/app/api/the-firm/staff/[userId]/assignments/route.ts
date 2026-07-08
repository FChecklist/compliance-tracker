import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAssignmentsForStaff, ServiceError } from "@/lib/services/firm-staff-assignment-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { userId } = await ctx.params
    const assignments = await listAssignmentsForStaff({ orgId }, userId)
    return NextResponse.json({ assignments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List staff's assignments error:", error)
    return NextResponse.json({ error: "Failed to list assignments" }, { status: 500 })
  }
}
