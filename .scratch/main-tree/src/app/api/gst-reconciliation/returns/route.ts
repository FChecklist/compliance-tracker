import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateReturn, listReturns, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function POST(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await req.json()
    if (!body.period || !body.gstin || !body.returnType) return NextResponse.json({ error: "period, gstin, and returnType are required" }, { status: 400 })
    if (!["gstr1", "gstr3b"].includes(body.returnType)) return NextResponse.json({ error: "returnType must be 'gstr1' or 'gstr3b'" }, { status: 400 })

    const result = await generateReturn({ orgId, userId: dbUser.id, dbUser }, { period: body.period, gstin: body.gstin, returnType: body.returnType, clientId: body.clientId ?? null })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST return generation error:", error)
    return NextResponse.json({ error: "Failed to generate return" }, { status: 500 })
  }
}

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ returns: [] })

  const returns = await listReturns({ orgId })
  return NextResponse.json({ returns })
}
