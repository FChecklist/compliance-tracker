import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { recordStockIssue, ServiceError } from "@/lib/services/erp-inventory-service"

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const entry = await recordStockIssue({ orgId, userId: dbUser.id, dbUser }, { ...body, voucherType: body.voucherType ?? "manual_issue", voucherId: body.voucherId ?? "manual" })
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stock issue error:", error)
    return NextResponse.json({ error: "Failed to record stock issue" }, { status: 500 })
  }
}
