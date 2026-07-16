import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAssetCategories, createAssetCategory, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ categories: [] })

  try {
    const categories = await listAssetCategories({ orgId })
    return NextResponse.json({ categories })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset categories list error:", error)
    return NextResponse.json({ error: "Failed to fetch asset categories" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const category = await createAssetCategory({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset category create error:", error)
    return NextResponse.json({ error: "Failed to create asset category" }, { status: 500 })
  }
}
