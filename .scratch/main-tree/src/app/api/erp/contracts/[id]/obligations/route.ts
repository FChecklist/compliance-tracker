import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { addObligation, ServiceError } from "@/lib/services/erp-contract-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const obligation = await addObligation({ orgId }, id, body)
    return NextResponse.json(obligation, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contract obligation create error:", error)
    return NextResponse.json({ error: "Failed to create obligation" }, { status: 500 })
  }
}
