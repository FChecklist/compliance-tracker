import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runReconciliation, listReconciliationRuns, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function POST(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await req.json()
    if (!body.period || !body.purchaseBatchId || !body.gstr2bBatchId) {
      return NextResponse.json({ error: "period, purchaseBatchId, and gstr2bBatchId are required" }, { status: 400 })
    }
    const result = await runReconciliation({ orgId, userId: dbUser.id, dbUser }, {
      period: body.period, clientId: body.clientId ?? null, purchaseBatchId: body.purchaseBatchId, gstr2bBatchId: body.gstr2bBatchId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST reconciliation error:", error)
    return NextResponse.json({ error: "Failed to run reconciliation" }, { status: 500 })
  }
}

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ runs: [] })

  const runs = await listReconciliationRuns({ orgId })
  return NextResponse.json({ runs })
}
