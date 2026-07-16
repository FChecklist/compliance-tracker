import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitFixedAsset, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await submitFixedAsset({ orgId, userId: dbUser.id, dbUser }, id, { sourceAccountId: body.sourceAccountId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed asset submit error:", error)
    return NextResponse.json({ error: "Failed to submit (capitalize) fixed asset" }, { status: 500 })
  }
}
