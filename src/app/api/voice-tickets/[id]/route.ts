import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getVoiceMemo, ServiceError } from "@/lib/services/voice-ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const memo = await getVoiceMemo({ orgId }, id)
    return NextResponse.json(memo)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Voice memo fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch voice memo" }, { status: 500 })
  }
}
