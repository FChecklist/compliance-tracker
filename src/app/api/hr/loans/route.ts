import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLoans, requestLoan, ServiceError } from "@/lib/services/hr-loan-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ loans: [] })

  try {
    const employeeId = request.nextUrl.searchParams.get("employeeId") || undefined
    const status = request.nextUrl.searchParams.get("status") || undefined
    const loans = await listLoans({ orgId }, { employeeId, status })
    return NextResponse.json({ loans })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Loans list error:", error)
    return NextResponse.json({ error: "Failed to fetch loans" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await requestLoan({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Loan request create error:", error)
    return NextResponse.json({ error: "Failed to create loan request" }, { status: 500 })
  }
}
