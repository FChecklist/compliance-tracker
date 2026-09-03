// R67 D-36: single-receipt GET for the new PROJEXA receipt object page, and
// PATCH for the SOFT void (voidedAt/voidReason/voidedBy). There is
// deliberately no DELETE -- see voidMaterialReceipt()'s own header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getMaterialReceipt, voidMaterialReceipt, ServiceError } from "@/lib/services/construction-materials-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const receipt = await getMaterialReceipt({ orgId: ctx.orgId }, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material receipt get error:", error)
    return NextResponse.json({ error: "Failed to fetch material receipt" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body?.action !== "void") {
      return NextResponse.json({ error: "Only { action: \"void\", voidReason } is supported on a receipt" }, { status: 400 })
    }
    const receipt = await voidMaterialReceipt({ orgId: ctx.orgId }, id, {
      voidReason: body?.voidReason ?? "",
      voidedBy: actorId,
    })
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material receipt void error:", error)
    return NextResponse.json({ error: "Failed to void material receipt" }, { status: 500 })
  }
}
