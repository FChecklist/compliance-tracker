import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createLostReason, listLostReasons, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json([])

  try {
    const { searchParams } = new URL(request.url)
    const reasons = await listLostReasons({ orgId }, { includeInactive: searchParams.get("includeInactive") === "true" })
    return NextResponse.json(reasons)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lost reasons list error:", error)
    return NextResponse.json({ error: "Failed to fetch lost reasons" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const reason = await createLostReason({ orgId, userId: dbUser.id }, body.reasonText)
    return NextResponse.json(reason, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lost reason create error:", error)
    return NextResponse.json({ error: "Failed to create lost reason" }, { status: 500 })
  }
}
