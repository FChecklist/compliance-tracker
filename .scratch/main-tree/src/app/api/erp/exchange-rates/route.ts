import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listExchangeRates, createExchangeRate, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ exchangeRates: [] })

  try {
    const exchangeRates = await listExchangeRates({ orgId })
    return NextResponse.json({ exchangeRates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Exchange rates list error:", error)
    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const rate = await createExchangeRate({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(rate, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Exchange rate create error:", error)
    return NextResponse.json({ error: "Failed to create exchange rate" }, { status: 500 })
  }
}
