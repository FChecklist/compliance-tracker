import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { assignStaffToClient, listAssignmentsForClient, ServiceError } from "@/lib/services/firm-staff-assignment-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const assignments = await listAssignmentsForClient({ orgId, userId: dbUser.id, dbUser }, clientId)
    return NextResponse.json({ assignments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List staff assignments error:", error)
    return NextResponse.json({ error: "Failed to list staff assignments" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json()
    if (!body.userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })
    const assignment = await assignStaffToClient({ orgId, userId: dbUser.id, dbUser }, clientId, body.userId, body)
    return NextResponse.json(assignment, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Assign staff error:", error)
    return NextResponse.json({ error: "Failed to assign staff" }, { status: 500 })
  }
}
