import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { listJournalEntries, createJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  try {
    const status = request.nextUrl.searchParams.get("status") || undefined
    const entries = await listJournalEntries({ orgId }, { status })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch journal entries" }, { status: 500 })
  }
}

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "member" rank (ERP_ACTION_ROLES["erp.journal_entries.create"]).
// "member" (not "manager") because createJournalEntry only inserts a DRAFT
// row (see erp-accounting-service.ts) -- it does not post to the GL; the
// submit/[id]/submit route is the action that actually posts and is the
// one gated at "manager". Matches the established pattern in this table
// (every other module's create action -- fixed_assets, sales_orders,
// quotations -- is "member" for the draft step).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.journal_entries.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const entry = await createJournalEntry({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Journal entry create error:", error)
    return NextResponse.json({ error: "Failed to create journal entry" }, { status: 500 })
  }
}
