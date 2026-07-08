import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { compareBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const comparison = await compareBoq({ orgId }, id)
    return NextResponse.json(comparison)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction BOQ compare error:", error)
    return NextResponse.json({ error: "Failed to compare BOQ revisions" }, { status: 500 })
  }
}
