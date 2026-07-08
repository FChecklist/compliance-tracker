import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createTaxCase, listTaxCasesForClient, ServiceError } from "@/lib/services/firm-tax-case-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const taxCases = await listTaxCasesForClient({ orgId }, clientId)
    return NextResponse.json({ taxCases })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List tax cases error:", error)
    return NextResponse.json({ error: "Failed to list tax cases" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json()
    const taxCase = await createTaxCase({ orgId, userId: dbUser.id }, { ...body, clientId })
    return NextResponse.json(taxCase, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Create tax case error:", error)
    return NextResponse.json({ error: "Failed to create tax case" }, { status: 500 })
  }
}
