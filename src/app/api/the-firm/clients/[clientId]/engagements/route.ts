import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createEngagement, listEngagementsForClient, ServiceError } from "@/lib/services/firm-engagement-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const engagements = await listEngagementsForClient({ orgId }, clientId)
    return NextResponse.json({ engagements })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List engagements error:", error)
    return NextResponse.json({ error: "Failed to list engagements" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json()
    const engagement = await createEngagement({ orgId, userId: dbUser.id }, { ...body, clientId })
    return NextResponse.json(engagement, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Create engagement error:", error)
    return NextResponse.json({ error: "Failed to create engagement" }, { status: 500 })
  }
}
