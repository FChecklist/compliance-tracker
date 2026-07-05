import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSignatureRequests, createSignatureRequest, ServiceError } from "@/lib/services/esignature-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ requests: [] })

  try {
    const { searchParams } = new URL(request.url)
    const linkedEntityType = searchParams.get("linkedEntityType") || undefined
    const linkedEntityId = searchParams.get("linkedEntityId") || undefined
    const requests = await listSignatureRequests({ orgId }, { linkedEntityType, linkedEntityId })
    return NextResponse.json({ requests })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signature requests list error:", error)
    return NextResponse.json({ error: "Failed to fetch signature requests" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const signatureRequest = await createSignatureRequest({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(signatureRequest, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Signature request create error:", error)
    return NextResponse.json({ error: "Failed to create signature request" }, { status: 500 })
  }
}
