// Wave 143: interior finish materials (flooring/wall/ceiling swatches with
// color + roughness/metalness for the 3D walkthrough). Named
// "design-materials" rather than "materials" to avoid collision with Wave
// 124's /api/v1/projexa/materials, which aliases the construction stock
// ledger -- a different concept entirely (physical inventory vs. a finish
// swatch/appearance definition).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listMaterials, createMaterial, ServiceError } from "@/lib/services/interior-floorplan-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const category = request.nextUrl.searchParams.get("category") ?? undefined

  try {
    const materials = await listMaterials({ orgId: ctx.orgId }, category)
    return NextResponse.json({ materials })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa design-materials list error:", error)
    return NextResponse.json({ error: "Failed to list materials" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const material = await createMaterial({ orgId: ctx.orgId }, body)
    return NextResponse.json(material, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa design-materials create error:", error)
    return NextResponse.json({ error: "Failed to create material" }, { status: 500 })
  }
}
