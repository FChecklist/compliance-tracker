import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listInstalledProducts, createInstalledProduct, ServiceError } from "@/lib/services/ticket-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ installedProducts: [] })

  try {
    const clientId = request.nextUrl.searchParams.get("clientId") ?? undefined
    const installedProducts = await listInstalledProducts({ orgId }, clientId)
    return NextResponse.json({ installedProducts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Installed products list error:", error)
    return NextResponse.json({ error: "Failed to fetch installed products" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const product = await createInstalledProduct({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Installed product create error:", error)
    return NextResponse.json({ error: "Failed to create installed product" }, { status: 500 })
  }
}
