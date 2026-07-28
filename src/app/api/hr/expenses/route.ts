import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listExpenseClaims, createExpenseClaim, ServiceError } from "@/lib/services/hr-expense-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ claims: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const status = request.nextUrl.searchParams.get("status") || undefined
    const claims = await listExpenseClaims({ orgId }, { userId, status })
    return NextResponse.json({ claims })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Expense claims list error:", error)
    return NextResponse.json({ error: "Failed to fetch expense claims" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createExpenseClaim({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Expense claim create error:", error)
    return NextResponse.json({ error: "Failed to create expense claim" }, { status: 500 })
  }
}
