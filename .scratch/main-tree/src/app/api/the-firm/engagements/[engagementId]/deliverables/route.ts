import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { addDeliverable, ServiceError } from "@/lib/services/firm-engagement-service"

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { engagementId } = await ctx.params
    const body = await req.json()
    const deliverable = await addDeliverable({ orgId, userId: dbUser.id, dbUser }, engagementId, body)
    return NextResponse.json(deliverable, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Add deliverable error:", error)
    return NextResponse.json({ error: "Failed to add deliverable" }, { status: 500 })
  }
}
