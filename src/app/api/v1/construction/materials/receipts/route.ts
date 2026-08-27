// Point 33: material inbound receipts. GET+POST, requireAuthOrApiKey shape.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listMaterialReceipts, createMaterialReceipt, ServiceError } from "@/lib/services/construction-materials-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ receipts: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const receipts = await listMaterialReceipts({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ receipts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material receipts list error:", error)
    return NextResponse.json({ error: "Failed to fetch material receipts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const receipt = await createMaterialReceipt({ orgId: ctx.orgId }, { ...body, createdById: actorId })
    return NextResponse.json(receipt, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material receipts create error:", error)
    return NextResponse.json({ error: "Failed to create material receipt" }, { status: 500 })
  }
}
