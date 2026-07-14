// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-accounting-service.ts's chart-of-accounts (listAccounts/createAccount).
// Read-heavy on purpose -- PROJEXA's General Ledger view needs the account
// list to populate a journal-entry line's account picker; account creation
// (setting up the chart of accounts itself) stays a VERIDIAN-side admin
// action for this wave, same "read-mostly, basic create only where it
// clearly makes sense" scope as the rest of Priority 15's accounting slice.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listAccounts, ServiceError } from "@/lib/services/erp-accounting-service"

function toAccountShape(a: Awaited<ReturnType<typeof listAccounts>>[number]) {
  return { id: a.id, accountName: a.accountName, accountNumber: a.accountNumber, rootType: a.rootType, accountType: a.accountType, parentAccountId: a.parentAccountId, isGroup: a.isGroup }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ accounts: [] })

  try {
    const accounts = await listAccounts({ orgId: ctx.orgId })
    return NextResponse.json({ accounts: accounts.map(toAccountShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch chart of accounts" }, { status: 500 })
  }
}
