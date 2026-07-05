import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { suggestMatches, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const bankGlAccountId = request.nextUrl.searchParams.get("bankGlAccountId")
    if (!bankGlAccountId) return NextResponse.json({ error: "bankGlAccountId is required" }, { status: 400 })
    const candidates = await suggestMatches({ orgId }, id, bankGlAccountId)
    return NextResponse.json({ candidates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Suggest matches error:", error)
    return NextResponse.json({ error: "Failed to suggest matches" }, { status: 500 })
  }
}
