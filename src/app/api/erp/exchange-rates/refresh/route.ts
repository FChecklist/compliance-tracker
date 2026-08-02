import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { refreshLiveExchangeRates, ServiceError } from "@/lib/services/erp-accounting-service"
import { ExchangeRateFeedError } from "@/lib/exchange-rate-feed-client"

export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await refreshLiveExchangeRates({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof ExchangeRateFeedError) return NextResponse.json({ error: error.message }, { status: 502 })
    console.error("Live exchange-rate refresh error:", error)
    return NextResponse.json({ error: "Failed to refresh live exchange rates" }, { status: 500 })
  }
}
