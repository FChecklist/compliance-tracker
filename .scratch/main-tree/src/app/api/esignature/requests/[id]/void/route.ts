import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { voidSignatureRequest, ServiceError } from "@/lib/services/esignature-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const signatureRequest = await voidSignatureRequest({ orgId }, id)
    return NextResponse.json(signatureRequest)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signature request void error:", error)
    return NextResponse.json({ error: "Failed to void signature request" }, { status: 500 })
  }
}
