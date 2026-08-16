import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateKbPage, ServiceError } from "@/lib/services/knowledge-base-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateKbPage({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Knowledge base update error:", error)
    return NextResponse.json({ error: "Failed to update knowledge base page" }, { status: 500 })
  }
}
