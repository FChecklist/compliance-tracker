import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitClaim, ServiceError } from "@/lib/services/construction-billing-workflow-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const claim = await submitClaim({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(claim)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim submit error:", error)
    return NextResponse.json({ error: "Failed to submit progress claim" }, { status: 500 })
  }
}
