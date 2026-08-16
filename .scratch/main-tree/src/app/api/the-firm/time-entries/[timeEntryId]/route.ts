import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateTimeEntry, ServiceError } from "@/lib/services/firm-time-tracking-service"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ timeEntryId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { timeEntryId } = await ctx.params
    const body = await req.json()
    const entry = await updateTimeEntry({ orgId, userId: dbUser.id, dbUser }, timeEntryId, body)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Update time entry error:", error)
    return NextResponse.json({ error: "Failed to update time entry" }, { status: 500 })
  }
}
