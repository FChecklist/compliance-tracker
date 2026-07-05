import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCustomers } from "@/lib/services/erp-selling-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ customers: [] })

  try {
    const customers = await listCustomers({ orgId })
    return NextResponse.json({ customers })
  } catch (error) {
    console.error("Customers list error:", error)
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }
}
