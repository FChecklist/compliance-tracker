import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listInvoicesForOrg } from "@/lib/services/platform-billing-service"

export async function GET() {
  const { user, orgId, response } = await requireAuth()
  if (!user) return response!
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const invoices = await listInvoicesForOrg(orgId)
    return NextResponse.json({ invoices })
  } catch (error) {
    console.error("Billing invoices list error:", error)
    return NextResponse.json({ error: "Failed to load billing invoices" }, { status: 500 })
  }
}
