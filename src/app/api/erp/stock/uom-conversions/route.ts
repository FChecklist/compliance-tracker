import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listUomConversions, createUomConversion, ServiceError } from "@/lib/services/erp-uom-batch-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ conversions: [] })

  try {
    const itemId = new URL(request.url).searchParams.get("itemId") ?? undefined
    const conversions = await listUomConversions({ orgId }, itemId)
    return NextResponse.json({ conversions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("UOM conversions list error:", error)
    return NextResponse.json({ error: "Failed to fetch UOM conversions" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const conversion = await createUomConversion({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(conversion, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("UOM conversion create error:", error)
    return NextResponse.json({ error: "Failed to create UOM conversion" }, { status: 500 })
  }
}
