import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { rollbackBusinessRule, ServiceError } from "@/lib/services/business-rules-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const toVersion = Number(body?.toVersion)
    if (!Number.isInteger(toVersion) || toVersion < 1) {
      return NextResponse.json({ error: "toVersion must be a positive integer" }, { status: 400 })
    }
    const result = await rollbackBusinessRule({ orgId, userId: dbUser.id }, id, toVersion)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rule rollback error:", error)
    return NextResponse.json({ error: "Failed to roll back business rule" }, { status: 500 })
  }
}
