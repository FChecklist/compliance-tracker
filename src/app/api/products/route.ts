import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listProducts, createProduct, ServiceError } from "@/lib/services/product-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ products: [] })

  try {
    const result = await listProducts({ orgId })
    return NextResponse.json({
      products: result.map((p) => ({ id: p.id, name: p.name, slug: p.slug, description: p.description, isActive: p.isActive, createdAt: p.createdAt.toISOString() })),
    })
  } catch (error) {
    console.error("Products list error:", error)
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createProduct({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Product create error:", error)
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 })
  }
}
