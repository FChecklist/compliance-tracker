import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitCodeChangeRequest, listCodeChangeRequests, ServiceError } from "@/lib/services/code-change-request-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ requests: [] })

  try {
    const result = await listCodeChangeRequests({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Code change requests list error:", error)
    return NextResponse.json({ error: "Failed to fetch code change requests" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await submitCodeChangeRequest({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Code change request submit error:", error)
    return NextResponse.json({ error: "Failed to submit code change request" }, { status: 500 })
  }
}
