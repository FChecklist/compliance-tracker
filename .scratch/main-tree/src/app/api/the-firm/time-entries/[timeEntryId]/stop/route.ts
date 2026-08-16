import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { stopTimer, ServiceError } from "@/lib/services/firm-time-tracking-service"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ timeEntryId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { timeEntryId } = await ctx.params
    const entry = await stopTimer({ orgId, userId: dbUser.id, dbUser }, timeEntryId)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stop timer error:", error)
    return NextResponse.json({ error: "Failed to stop timer" }, { status: 500 })
  }
}
