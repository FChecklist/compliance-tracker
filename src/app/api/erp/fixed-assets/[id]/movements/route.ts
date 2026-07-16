import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAssetMovements, createAssetMovement, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const movements = await listAssetMovements({ orgId }, id)
    return NextResponse.json({ movements })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset movements list error:", error)
    return NextResponse.json({ error: "Failed to fetch asset movements" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const movement = await createAssetMovement({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(movement, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset movement create error:", error)
    return NextResponse.json({ error: "Failed to record asset movement" }, { status: 500 })
  }
}
