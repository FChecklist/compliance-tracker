import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCurrencies, createCurrency, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ currencies: [] })

  try {
    const currencies = await listCurrencies({ orgId })
    return NextResponse.json({ currencies })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Currencies list error:", error)
    return NextResponse.json({ error: "Failed to fetch currencies" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const currency = await createCurrency({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(currency, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Currency create error:", error)
    return NextResponse.json({ error: "Failed to create currency" }, { status: 500 })
  }
}
