import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { resolveInstructionMismatch, ServiceError } from "@/lib/services/chat-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await resolveInstructionMismatch({ orgId, userId: dbUser.id }, id, body.action)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Instruction mismatch resolve error:", error)
    return NextResponse.json({ error: "Failed to resolve instruction mismatch" }, { status: 500 })
  }
}
