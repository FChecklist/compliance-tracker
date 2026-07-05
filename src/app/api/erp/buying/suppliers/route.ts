import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSuppliers } from "@/lib/services/erp-buying-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ suppliers: [] })

  try {
    const suppliers = await listSuppliers({ orgId })
    return NextResponse.json({ suppliers })
  } catch (error) {
    console.error("Suppliers list error:", error)
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 })
  }
}
