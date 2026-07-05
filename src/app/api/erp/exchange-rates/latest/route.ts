import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getLatestExchangeRate, ServiceError } from "@/lib/services/erp-accounting-service"

// Wave 66: a convenience lookup for the invoicing/journal-entry UI to
// suggest a starting rate. Never auto-applied -- the create routes always
// require an explicit exchangeRate in the request body.
export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rate: null })

  const { searchParams } = new URL(request.url)
  const fromCurrencyId = searchParams.get("from")
  const toCurrencyId = searchParams.get("to")
  const asOfDate = searchParams.get("date")
  if (!fromCurrencyId || !toCurrencyId || !asOfDate) {
    return NextResponse.json({ error: "from, to, and date query params are required" }, { status: 400 })
  }

  try {
    const rate = await getLatestExchangeRate({ orgId }, fromCurrencyId, toCurrencyId, asOfDate)
    return NextResponse.json({ rate })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Latest exchange rate lookup error:", error)
    return NextResponse.json({ error: "Failed to fetch exchange rate" }, { status: 500 })
  }
}
