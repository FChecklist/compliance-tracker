import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { rejectCommunication, ServiceError } from "@/lib/services/communication-drafting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await rejectCommunication({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drafted communication reject error:", error)
    return NextResponse.json({ error: "Failed to reject communication" }, { status: 500 })
  }
}
