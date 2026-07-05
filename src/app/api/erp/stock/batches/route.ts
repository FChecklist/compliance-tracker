import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBatches, createBatch, ServiceError } from "@/lib/services/erp-uom-batch-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ batches: [] })

  try {
    const itemId = new URL(request.url).searchParams.get("itemId") ?? undefined
    const batches = await listBatches({ orgId }, itemId)
    return NextResponse.json({ batches })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Batches list error:", error)
    return NextResponse.json({ error: "Failed to fetch batches" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const batch = await createBatch({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(batch, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Batch create error:", error)
    return NextResponse.json({ error: "Failed to create batch" }, { status: 500 })
  }
}
