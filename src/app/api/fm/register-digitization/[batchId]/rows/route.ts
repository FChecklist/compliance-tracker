import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listDigitizationRows, ServiceError } from "@/lib/services/fm-register-digitization-service"

// Read-only display for a just-extracted batch -- the minimal upload page's
// last step. Reviewing/editing/committing rows (reviewDigitizationRow,
// commitDigitizationBatch) is deliberately not wired to any route yet; this
// only shows what the AI extracted.
export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { batchId } = await params
    const rows = await listDigitizationRows({ orgId }, batchId)
    return NextResponse.json({ rows })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("FM digitization rows list error:", error)
    return NextResponse.json({ error: "Failed to list digitization rows" }, { status: 500 })
  }
}
