import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateEngagement, ServiceError } from "@/lib/services/firm-engagement-service"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { engagementId } = await ctx.params
    const body = await req.json()
    const engagement = await updateEngagement({ orgId, userId: dbUser.id, dbUser }, engagementId, body)
    return NextResponse.json(engagement)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Update engagement error:", error)
    return NextResponse.json({ error: "Failed to update engagement" }, { status: 500 })
  }
}
