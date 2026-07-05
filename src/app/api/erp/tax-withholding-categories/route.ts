import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listTaxWithholdingCategories, createTaxWithholdingCategory, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ categories: [] })

  try {
    const categories = await listTaxWithholdingCategories({ orgId })
    return NextResponse.json({ categories })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tax withholding categories list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax withholding categories" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const category = await createTaxWithholdingCategory({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tax withholding category create error:", error)
    return NextResponse.json({ error: "Failed to create tax withholding category" }, { status: 500 })
  }
}
