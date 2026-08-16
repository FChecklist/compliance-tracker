import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSerials, createSerials, ServiceError } from "@/lib/services/erp-uom-batch-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ serials: [] })

  try {
    const itemId = new URL(request.url).searchParams.get("itemId") ?? undefined
    const serials = await listSerials({ orgId }, itemId)
    return NextResponse.json({ serials })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Serials list error:", error)
    return NextResponse.json({ error: "Failed to fetch serials" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const serials = await createSerials({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json({ serials }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Serials create error:", error)
    return NextResponse.json({ error: "Failed to create serials" }, { status: 500 })
  }
}
