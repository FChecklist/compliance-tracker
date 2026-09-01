import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getSiteInstruction, ServiceError } from "@/lib/services/construction-site-instruction-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const row = await getSiteInstruction({ orgId: ctx.orgId }, id)
    return NextResponse.json(row)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site-instruction get error:", error)
    return NextResponse.json({ error: "Failed to fetch site instruction" }, { status: 500 })
  }
}
