import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { promoteEmailIntelligenceItem, ServiceError } from "@/lib/services/email-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

// Human-gated by construction: a suggested work item only becomes a real
// task via this explicit call, never automatically from analysis itself
// (U-D21.B1.S1: "No object created without approval").
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await promoteEmailIntelligenceItem({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence promote error:", error)
    return NextResponse.json({ error: "Failed to promote email intelligence item" }, { status: 500 })
  }
}
