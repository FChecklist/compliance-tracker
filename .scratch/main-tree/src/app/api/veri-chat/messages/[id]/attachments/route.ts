import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { attachDocumentToMessage, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 })
    const result = await attachDocumentToMessage({ orgId, userId: dbUser.id }, id, body.documentId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat attach document error:", error)
    return NextResponse.json({ error: "Failed to attach document" }, { status: 500 })
  }
}
