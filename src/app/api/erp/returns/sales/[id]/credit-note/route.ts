import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { linkSalesReturnCreditNote, ServiceError } from "@/lib/services/erp-returns-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const updated = await linkSalesReturnCreditNote({ orgId, userId: dbUser.id, dbUser }, id, body.creditNoteId)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales return credit note link error:", error)
    return NextResponse.json({ error: "Failed to link credit note" }, { status: 500 })
  }
}
