import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPaymentEntries, createPaymentEntry, ServiceError, type PaymentEntryListFilters } from "@/lib/services/erp-payment-entries-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [], total: 0, page: 1, limit: 25, totalPages: 0 })

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get("status") ?? undefined
    const partyType = sp.get("partyType") ?? undefined
    const result = await listPaymentEntries({ orgId }, {
      status: status as PaymentEntryListFilters["status"],
      partyType: partyType as PaymentEntryListFilters["partyType"],
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payment entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch payment entries" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const entry = await createPaymentEntry({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payment entry create error:", error)
    return NextResponse.json({ error: "Failed to create payment entry" }, { status: 500 })
  }
}
