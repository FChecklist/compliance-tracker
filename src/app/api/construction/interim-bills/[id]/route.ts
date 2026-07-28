import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getInterimBill, ServiceError } from "@/lib/services/construction-valuation-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const bill = await getInterimBill({ orgId }, id)
    return NextResponse.json(bill)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction interim bill get error:", error)
    return NextResponse.json({ error: "Failed to fetch interim bill" }, { status: 500 })
  }
}
