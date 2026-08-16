import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSalesCreditNotes, createSalesCreditNote, ServiceError } from "@/lib/services/erp-credit-note-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ creditNotes: [] })

  try {
    const creditNotes = await listSalesCreditNotes({ orgId })
    return NextResponse.json({ creditNotes })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales credit notes list error:", error)
    return NextResponse.json({ error: "Failed to fetch sales credit notes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: creates draft, not yet posted
  const roleErr = requirePermissionForUser(dbUser, "erp.sales_credit_notes.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const note = await createSalesCreditNote({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales credit note create error:", error)
    return NextResponse.json({ error: "Failed to create sales credit note" }, { status: 500 })
  }
}
