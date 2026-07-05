import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listDuplicateCandidates, ServiceError } from "@/lib/services/mdm-quality-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ candidates: [] })

  try {
    const { searchParams } = new URL(request.url)
    const candidates = await listDuplicateCandidates(
      { orgId },
      searchParams.get("entityType") ?? undefined,
      searchParams.get("status") ?? undefined,
    )
    return NextResponse.json({ candidates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("MDM duplicate candidates fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch duplicate candidates" }, { status: 500 })
  }
}
