import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLandedCostVouchers, createLandedCostVoucher, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ vouchers: [] })

  try {
    const { id } = await params
    const vouchers = await listLandedCostVouchers({ orgId }, id)
    return NextResponse.json({ vouchers })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Landed cost vouchers list error:", error)
    return NextResponse.json({ error: "Failed to fetch landed cost vouchers" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const voucher = await createLandedCostVoucher({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(voucher, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Landed cost voucher create error:", error)
    return NextResponse.json({ error: "Failed to create landed cost voucher" }, { status: 500 })
  }
}
