import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAccountOverview, updateAccount, deleteAccount, ServiceError } from "@/lib/services/crm-accounts-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const overview = await getAccountOverview({ orgId }, id)
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account get error:", error)
    return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const account = await updateAccount({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(account)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account update error:", error)
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
  }
}

// VERIDIAN Review Framework Wave 4 (2026-07-17): there was previously no
// way to delete a crm_accounts row at all -- deleteAccount() gates this at
// manager rank or above (see canReassignOrDeleteAccount in
// crm-accounts-service.ts) and blocks the delete if the account still has
// linked contacts/child accounts/leads/opportunities (referential-
// integrity gap this same wave closed, since crm_accounts has no DB-level
// FK from those tables).
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteAccount({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account delete error:", error)
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
  }
}
