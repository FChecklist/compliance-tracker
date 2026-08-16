import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { startEnrollment, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const enrollment = await startEnrollment({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(enrollment)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollment start error:", error)
    return NextResponse.json({ error: "Failed to start course" }, { status: 500 })
  }
}
