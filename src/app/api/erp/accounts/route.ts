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

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "manager" rank (ERP_ACTION_ROLES["erp.chart_of_accounts.create"]).
// "manager" (not "member") because defining a GL account is master-data
// configuration that shapes where an entire class of transactions posts
// -- a data-entry clerk should be able to log a purchased laptop, not
// redefine which GL account every laptop in the company posts depreciation
// against. Matches the established precedent for category/master-data
// configuration (erp.fixed_assets.category_manage: "manager").
export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
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
