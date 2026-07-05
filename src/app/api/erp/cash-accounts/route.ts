import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCashAccounts, createCashAccount, ServiceError } from "@/lib/services/erp-cash-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ cashAccounts: [] })

  try {
    const cashAccounts = await listCashAccounts({ orgId })
    return NextResponse.json({ cashAccounts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cash accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch cash accounts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const account = await createCashAccount({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cash account create error:", error)
    return NextResponse.json({ error: "Failed to create cash account" }, { status: 500 })
  }
}
