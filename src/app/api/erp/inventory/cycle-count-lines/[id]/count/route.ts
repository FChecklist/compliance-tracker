import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { recordCycleCount, ServiceError } from "@/lib/services/erp-inventory-planning-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const line = await recordCycleCount({ orgId, userId: dbUser.id }, id, Number(body.countedQty))
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cycle count record error:", error)
    return NextResponse.json({ error: "Failed to record count" }, { status: 500 })
  }
}
