import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateFormData, ServiceError } from "@/lib/services/mca-filing-service"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const filing = await generateFormData({ orgId }, id, body)
    return NextResponse.json({ filing })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Generate MCA form data error:", error)
    return NextResponse.json({ error: "Failed to generate form data" }, { status: 500 })
  }
}
