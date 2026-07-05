import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listRfqs, createRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rfqs: [] })

  try {
    const rfqs = await listRfqs({ orgId })
    return NextResponse.json({ rfqs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQs list error:", error)
    return NextResponse.json({ error: "Failed to fetch RFQs" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const rfq = await createRfq({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(rfq, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQ create error:", error)
    return NextResponse.json({ error: "Failed to create RFQ" }, { status: 500 })
  }
}
