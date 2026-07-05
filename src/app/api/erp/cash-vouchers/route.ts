import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCashVouchers, createAndPostCashVoucher, ServiceError } from "@/lib/services/erp-cash-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ vouchers: [] })

  try {
    const cashAccountId = request.nextUrl.searchParams.get("cashAccountId") || undefined
    const vouchers = await listCashVouchers({ orgId }, { cashAccountId })
    return NextResponse.json({ vouchers })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cash vouchers list error:", error)
    return NextResponse.json({ error: "Failed to fetch cash vouchers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const voucher = await createAndPostCashVoucher({ orgId, userId: dbUser.id, dbUser }, body)

    try {
      const { deliverWebhook } = await import("@/lib/webhook-deliver")
      await deliverWebhook(orgId, "erp_cash_voucher.posted", { voucherId: voucher.id, voucherType: voucher.voucherType, amount: voucher.amount })
    } catch (webhookError) {
      console.error("Webhook delivery error (non-fatal):", webhookError)
    }

    return NextResponse.json(voucher, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cash voucher create error:", error)
    return NextResponse.json({ error: "Failed to create cash voucher" }, { status: 500 })
  }
}
