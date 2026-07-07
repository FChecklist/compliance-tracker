import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { voidCommissionAccrual, ServiceError } from "@/lib/services/sales-engine-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const { id } = await params
    const { note } = await request.json()
    const result = await voidCommissionAccrual({ dbUser }, id, note)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Void commission accrual error:", error)
    return NextResponse.json({ error: "Failed to void commission accrual" }, { status: 500 })
  }
}
