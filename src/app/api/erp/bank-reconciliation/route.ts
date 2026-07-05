import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listImports, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ imports: [] })

  try {
    const imports = await listImports({ orgId })
    return NextResponse.json({ imports })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Bank statement imports list error:", error)
    return NextResponse.json({ error: "Failed to fetch imports" }, { status: 500 })
  }
}
