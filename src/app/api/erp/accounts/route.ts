import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { listAccounts, createAccount, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ accounts: [] })

  try {
    const accounts = await listAccounts({ orgId })
    return NextResponse.json({ accounts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: creating GL accounts is master data that affects the entire accounting structure
  const roleErr = requirePermissionForUser(dbUser, "erp.chart_of_accounts.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const account = await createAccount({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Account create error:", error)
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
  }
}
