import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLines, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ lines: [] })

  try {
    const { id } = await params
    const lines = await listLines({ orgId }, id)
    return NextResponse.json({ lines })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Bank statement lines list error:", error)
    return NextResponse.json({ error: "Failed to fetch lines" }, { status: 500 })
  }
}
