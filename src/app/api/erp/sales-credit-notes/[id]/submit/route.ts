import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitSalesCreditNote, ServiceError } from "@/lib/services/erp-credit-note-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: posts reversing GL entries, moves money
  const roleErr = requirePermissionForUser(dbUser, "erp.sales_credit_notes.submit")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const note = await submitSalesCreditNote({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(note)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales credit note submit error:", error)
    return NextResponse.json({ error: "Failed to submit sales credit note" }, { status: 500 })
  }
}
