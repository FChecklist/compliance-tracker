import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLoanInstallments, ServiceError } from "@/lib/services/hr-loan-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ installments: [] })

  try {
    const { id } = await params
    const installments = await listLoanInstallments({ orgId }, id)
    return NextResponse.json({ installments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Loan installments list error:", error)
    return NextResponse.json({ error: "Failed to fetch loan installments" }, { status: 500 })
  }
}
