import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBankAccounts, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ bankAccounts: [] })

  try {
    const bankAccounts = await listBankAccounts({ orgId })
    return NextResponse.json({ bankAccounts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Bank accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 })
  }
}
