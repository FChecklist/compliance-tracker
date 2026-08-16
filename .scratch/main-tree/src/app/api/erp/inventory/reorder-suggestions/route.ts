import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getReorderSuggestions, ServiceError } from "@/lib/services/erp-inventory-planning-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ suggestions: [] })

  try {
    const suggestions = await getReorderSuggestions({ orgId })
    return NextResponse.json({ suggestions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Reorder suggestions error:", error)
    return NextResponse.json({ error: "Failed to compute reorder suggestions" }, { status: 500 })
  }
}
