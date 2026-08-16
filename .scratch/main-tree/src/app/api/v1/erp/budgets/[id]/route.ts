import { NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getBudget, ServiceError } from "@/lib/services/erp-budget-service"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const budget = await getBudget({ orgId: ctx.orgId }, id)
    return NextResponse.json(budget)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp budget get error:", error)
    return NextResponse.json({ error: "Failed to fetch budget" }, { status: 500 })
  }
}
